// Marker icon bookkeeping shared by the editor and its tests (#219). The
// renderer never imports this module: it only reads `definition.icons`.
import type { ClickMapDefinition, MarkerIcon } from "./types.js";

/** Keys of `definition.icons` that some marker (in any view) draws. */
export function usedIconKeys(definition: Pick<ClickMapDefinition, "views" | "icons">): Set<string> {
  const used = new Set<string>();
  const icons = definition.icons ?? {};
  for (const view of definition.views) {
    for (const layer of view.layers) {
      for (const area of layer.areas) {
        const icon = area.geometry.type === "marker" ? area.geometry.icon : undefined;
        if (icon !== undefined && Object.prototype.hasOwnProperty.call(icons, icon)) used.add(icon);
      }
    }
  }
  return used;
}

/** Asset IDs referenced by anything other than an icon. */
function nonIconAssetIds(definition: ClickMapDefinition): Set<string> {
  const ids = new Set<string>();
  for (const view of definition.views) {
    if (view.background) ids.add(view.background.assetId);
    for (const layer of view.layers) {
      for (const area of layer.areas) {
        if (area.image) ids.add(area.image.assetId);
        if (area.image?.hitMask) ids.add(area.image.hitMask.assetId);
      }
    }
  }
  return ids;
}

const pruned = new WeakMap<ClickMapDefinition, ClickMapDefinition>();

/**
 * The definition as published: only the icons markers use, and none of the
 * assets that only unused icons referenced. Other assets are kept as they
 * are. Returns `definition` itself when there is nothing to drop, and the
 * same object for the same input, so callers can memoize on it.
 */
export function pruneUnusedIcons(definition: ClickMapDefinition): ClickMapDefinition {
  const cached = pruned.get(definition);
  if (cached) return cached;
  let result = definition;
  const icons = definition.icons;
  if (icons) {
    const used = usedIconKeys(definition);
    const keys = Object.keys(icons);
    if (used.size !== keys.length) {
      const kept: Record<string, MarkerIcon> = {};
      for (const key of keys) if (used.has(key)) kept[key] = icons[key]!;
      const keep = nonIconAssetIds(definition);
      for (const icon of Object.values(kept)) if (icon.assetId) keep.add(icon.assetId);
      const dropped = new Set(keys.filter((key) => !used.has(key)).map((key) => icons[key]!.assetId).filter((id): id is string => !!id && !keep.has(id)));
      const { icons: _icons, ...rest } = definition;
      result = {
        ...rest,
        ...(used.size ? { icons: kept } : {}),
        assets: dropped.size ? definition.assets.filter((asset) => !dropped.has(asset.id)) : definition.assets,
      };
    } else if (keys.length === 0) {
      const { icons: _icons, ...rest } = definition;
      result = rest;
    }
  }
  pruned.set(definition, result);
  return result;
}
