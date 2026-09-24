"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

/*
 * Scanning a QR code with this device's camera — today, the code a TV shows at
 * /pair, from the screen's own settings. The camera stays on only while the
 * scanner is open and stops the moment a code is read or it's closed.
 *
 * Uses the browser's own BarcodeDetector where there is one (Chrome on
 * Android), and jsQR otherwise (Safari on iPhone has none), loaded only when a
 * scan starts. Needs HTTPS, which the dashboard always is outside local runs.
 */

type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export function QrScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser can't use the camera here. Type the code instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setProblem(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in your browser's settings, or type the code instead."
            : "No camera could be opened. Type the code instead.",
        );
        return;
      }
      if (stopped) return stop();
      const video = videoRef.current;
      if (!video) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});

      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike })
        .BarcodeDetector;
      const native = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = native ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          let value: string | null = null;
          try {
            if (native) {
              value = (await native.detect(video))[0]?.rawValue ?? null;
            } else if (jsQR && context) {
              // A frame at most 640px wide is plenty to read a TV's code.
              const scale = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const frame = context.getImageData(0, 0, canvas.width, canvas.height);
              value = jsQR(frame.data, frame.width, frame.height)?.data ?? null;
            }
          } catch {
            // A frame that can't be read; try the next one.
          }
          if (value) {
            stop();
            onScan(value);
            return;
          }
        }
        timer = setTimeout(tick, 150);
      };
      void tick();
    })();

    return stop;
  }, [onScan]);

  return (
    <div className="flex flex-col gap-3" data-qr-scanner>
      {problem ? (
        <p role="alert" className="text-body">
          {problem}
        </p>
      ) : (
        <>
          <div className="rounded-panel border-rule bg-ink relative aspect-square w-full max-w-72 overflow-hidden border">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="Camera" />
            <span aria-hidden className="border-surface/80 pointer-events-none absolute inset-[18%] rounded-[6px] border-2" />
          </div>
          <p className="text-meta text-ink-soft">Point the camera at the QR code on the TV.</p>
        </>
      )}
      <div>
        <Button variant="tertiary" onClick={onClose}>
          {problem ? "Close" : "Stop scanning"}
        </Button>
      </div>
    </div>
  );
}

/** The 6-digit pairing code in what a scan read: a /connect?code= link, or the digits alone. */
export function pairingCodeFrom(scanned: string): string | null {
  try {
    const code = new URL(scanned).searchParams.get("code");
    if (code && /^\d{6}$/.test(code)) return code;
  } catch {
    // Not a link.
  }
  const digits = scanned.replace(/\s/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
