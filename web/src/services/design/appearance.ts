import type { ComponentNode, ComponentType } from '../../engine/openRocketEngine';
import { hexOf, parseHexColor } from './colorHex';
import { colorForType, DEFAULT_PART_COLORS, type PartPalette } from './partColors';

/**
 * A part's 3D appearance: the desktop Appearance tab's lower half, without the
 * texture.
 *
 * Two colors describe a part in a `.ork`, and they are separate settings. The
 * figure color (`<color>`, node key `color`) is what the 2D views draw. The
 * appearance (`<appearance>`, node key `appearance`) is what the 3D view
 * renders: a paint color, its alpha (desktop's Opacity), and a shine. A part
 * with no appearance of its own is drawn with the default for its type
 * (`DefaultAppearance.getDefaultAppearance`), which is a texture on the
 * desktop and here the Settings palette color with the default's shine.
 *
 * The parts that implement `InsideColorComponent` also carry an inside
 * appearance (`<insideappearance>`), used when `separateInsideOutside` is set,
 * and `edgesSameAsInside`, which picks which of the two the cut edges take. A
 * fin set calls its two sides left (outside) and right (inside).
 */
export interface PartAppearance {
  /** `#rrggbb`. */
  paint: string;
  /** The paint's alpha, 0-255, as `ORColor` stores it. Desktop's Opacity is this over 255. */
  alpha: number;
  /** 0-1, clamped as the `Appearance` constructor clamps it. */
  shine: number;
  /**
   * `<opacityaffectstexture>`, from a desktop newer than 24.12. There is no
   * texture here for it to affect, so it has no control; it is kept so a save
   * writes back what was read.
   */
  opacityAffectsTexture?: boolean;
}

/** One surface's look, resolved for drawing. */
export interface Look {
  color: string;
  /** 0-1. */
  shine: number;
  /** 0-1. */
  opacity: number;
}

/** The parts that implement `InsideColorComponent`. */
export const INSIDE_COLOR_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'bodytube',
  'innertube',
  'nosecone',
  'transition',
  'launchlug',
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'tubefinset',
]);

/** A fin set's two sides are left and right, not outside and inside (`AppearancePanel`). */
export const SIDED_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
]);

/**
 * The shine of each type's default appearance (`DefaultAppearance`): the
 * spiral-wound tubes and the plastic parts carry one, the textures (`simple`)
 * have none. A type desktop has no default for gets none.
 */
const DEFAULT_SHINE: Partial<Record<ComponentType, number>> = {
  bodytube: 0.3, // ESTES_BT
  innertube: 0.1, // ESTES_IT
  tubecoupler: 0.1,
  tubefinset: 0.1,
  launchlug: 0.3, // WHITE_BT
  nosecone: 0.3, // getPlastic: a nose cone is a Transition
  transition: 0.3,
  railbutton: 0.3,
};

/**
 * What `new AppearanceBuilder()` starts from (`resetToDefaults`): the
 * appearance a part takes when "Use default" is cleared and it had none.
 */
export const BUILDER_DEFAULT: PartAppearance = { paint: '#bbbbbb', alpha: 255, shine: 0.3 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A stored appearance, or undefined when the value is not one. The value can
 * come from an autosaved session or a saved part, so it is checked rather than
 * cast.
 */
export function readAppearance(v: unknown): PartAppearance | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const rgb = parseHexColor(o['paint']);
  if (rgb === null) return undefined;
  const alpha = typeof o['alpha'] === 'number' && Number.isFinite(o['alpha']) ? o['alpha'] : 255;
  const shine = typeof o['shine'] === 'number' && Number.isFinite(o['shine']) ? o['shine'] : 0;
  return {
    paint: hexOf(rgb),
    alpha: Math.round(Math.min(255, Math.max(0, alpha))),
    shine: clamp01(shine),
    ...(o['opacityAffectsTexture'] === true ? { opacityAffectsTexture: true } : {}),
  };
}

/** The default appearance of a part type, in the given palette. */
export function defaultAppearance(type: ComponentType, palette: PartPalette = DEFAULT_PART_COLORS): PartAppearance {
  return { paint: colorForType(type, palette), alpha: 255, shine: DEFAULT_SHINE[type] ?? 0 };
}

/** The appearance a part is drawn with on its outside: its own, else its type's default. */
export function outsideAppearance(node: ComponentNode, palette?: PartPalette): PartAppearance {
  return readAppearance(node['appearance']) ?? defaultAppearance(node.type, palette);
}

/** The inside appearance as stored, else the type's default (`RealisticRenderer.getInsideAppearance`). */
function insideAppearance(node: ComponentNode, palette?: PartPalette): PartAppearance {
  return readAppearance(node['insideAppearance']) ?? defaultAppearance(node.type, palette);
}

/** Opacity (desktop's spinner value) from an alpha byte. */
export const opacityOf = (a: PartAppearance): number => a.alpha / 255;

/** An alpha byte from an opacity, truncated as `AppearanceBuilder.setOpacity` does. */
export const alphaOf = (opacity: number): number => Math.trunc(clamp01(opacity) * 255);

const lookOf = (a: PartAppearance): Look => ({ color: a.paint, shine: a.shine, opacity: opacityOf(a) });

/**
 * The three surfaces a part is drawn with, as `RealisticRenderer.renderComponent`
 * picks them: a part with no inside appearance draws its inside and edges with
 * the outside one; one with an inside appearance uses it for the inside only
 * when the two are separate, and for the edges when `edgesSameAsInside` is set.
 */
export function partLooks(node: ComponentNode, palette?: PartPalette): { outside: Look; inside: Look; edges: Look } {
  const outside = outsideAppearance(node, palette);
  if (!INSIDE_COLOR_TYPES.has(node.type)) {
    const l = lookOf(outside);
    return { outside: l, inside: l, edges: l };
  }
  const inside = node['separateInsideOutside'] === true ? insideAppearance(node, palette) : outside;
  return {
    outside: lookOf(outside),
    inside: lookOf(inside),
    edges: lookOf(node['edgesSameAsInside'] === true ? inside : outside),
  };
}

/** The parts that extend `ExternalComponent`, whose figure shine follows their finish. */
const EXTERNAL_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  'nosecone',
  'transition',
  'bodytube',
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'tubefinset',
  'launchlug',
  'railbutton',
]);

/**
 * `FigureRenderer.getShine`: the shininess an external part's finish gives it,
 * out of OpenGL's 128, and 20 for an internal part. A finish 24.12 does not
 * list takes the switch's default.
 */
const FIGURE_SHININESS: Partial<Record<string, number>> = {
  rough: 10,
  unfinished: 30,
  normal: 40,
  smooth: 80,
  polished: 128,
};

/** A hex color with each channel scaled, as `FigureRenderer` darkens the inside. */
const scaled = (hex: string, k: number): string => {
  const n = parseHexColor(hex) ?? 0;
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * k);
  return hexOf((ch(16) << 16) | (ch(8) << 8) | ch(0));
};

/**
 * The looks of desktop's 3D Figure view (`FigureRenderer.renderComponent`):
 * the figure color, else the type's default, on the outside and the edges,
 * the same color at 70% on the inside, and a shine from the finish. Opaque:
 * what the view shows through is decided by the part, not its color.
 */
export function figureLooks(node: ComponentNode, palette?: PartPalette): { outside: Look; inside: Look; edges: Look } {
  const rgb = parseHexColor(node['color']);
  const color = rgb === null ? colorForType(node.type, palette) : hexOf(rgb);
  const finish = typeof node['finish'] === 'string' ? node['finish'] : 'normal';
  const shininess = EXTERNAL_TYPES.has(node.type) ? (FIGURE_SHININESS[finish] ?? 100) : 20;
  const outside = { color, shine: shininess / 128, opacity: 1 };
  return { outside, inside: { color: scaled(color, 0.7), shine: 0, opacity: 1 }, edges: outside };
}
