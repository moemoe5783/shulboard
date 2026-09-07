"use client";

import type { BundleEnvelope } from "@/lib/bundle/types";

/*
 * Last-known-good, in IndexedDB — docs/plan.md §3c.
 *
 * "On boot, render from it IMMEDIATELY, then fetch fresh in the background."
 * That ordering is the whole product promise. A screen that waited for the
 * network before drawing would show a black rectangle every time the shul's
 * router rebooted, and the thing a gabbai fears is a black screen in a lobby
 * with forty people walking past it.
 *
 * IndexedDB rather than localStorage: a bundle carries 90 days of zmanim and
 * every board on the playlist, which goes past localStorage's ~5MB in a way that
 * fails by throwing mid-write. IndexedDB is also off the main thread, so reading
 * a large bundle does not stall the first paint it exists to produce.
 */

const DB_NAME = "shulboard";
const DB_VERSION = 1;
const STORE = "bundles";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T | null>((resolve) => {
    openDatabase()
      .then((db) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result ?? null);
        // Never rejects. A television with a full disk, a browser in a private
        // mode, a corrupt database — none of those may stop the screen from
        // rendering whatever it has. Storage is an optimisation here, and an
        // optimisation that can take the display down is a liability.
        request.onerror = () => resolve(null);
        db.onerror = () => resolve(null);
      })
      .catch(() => resolve(null));
  });
}

/** Keyed by token: a device that is re-paired starts from a clean bundle rather
 *  than briefly showing the previous screen's board. */
export const readBundle = (token: string) =>
  withStore<BundleEnvelope>("readonly", (store) => store.get(token) as IDBRequest<BundleEnvelope>);

export const writeBundle = (token: string, bundle: BundleEnvelope) =>
  withStore("readwrite", (store) => store.put(bundle, token) as IDBRequest<IDBValidKey>);

export const forgetBundle = (token: string) =>
  withStore("readwrite", (store) => store.delete(token) as unknown as IDBRequest<undefined>);
