import type { BoardWidget } from "@/lib/board-doc";
import { getManifest } from "@/widgets/manifests";

/**
 * What to call one widget in the layers panel.
 *
 * The manifest decides. A layers panel that switched on widget type here would
 * be the central edit per widget that the registry exists to avoid — and it is
 * the kind of switch that quietly stops covering every case around widget nine.
 */
export function widgetLabel(widget: BoardWidget): string {
  const manifest = getManifest(widget.type);
  if (!manifest) return widget.type;

  const label = manifest.instanceLabel?.(widget.config as never)?.trim();
  return label || manifest.name;
}
