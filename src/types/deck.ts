// ----- Geometry -----

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
  /** Width / height ratio. When present in JSON and h is 0 or omitted, h is derived as w / aspectRatio at load time. */
  aspectRatio?: number;
}

// ----- Slide Background -----

export interface SlideBackground {
  color?: string;
  image?: string;
}

// ----- Slide Transition -----

export type TransitionType = "fade" | "slide" | "morph" | "none";

export interface SlideTransition {
  type: TransitionType;
  duration?: number;
}

// ----- Crop -----

export interface CropRect {
  top: number;    // 0-1 fraction cropped from top
  right: number;  // 0-1 fraction cropped from right
  bottom: number; // 0-1 fraction cropped from bottom
  left: number;   // 0-1 fraction cropped from left
}

// ----- Element Styles -----

export type TextSizing = "flexible" | "fixed";

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  textSizing?: TextSizing;
  color?: string;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
  verticalAlign?: "top" | "middle" | "bottom";
}

export interface ImageStyle {
  objectFit?: "contain" | "cover" | "fill";
  borderRadius?: number;
  opacity?: number;
  border?: string;
  crop?: CropRect;
}

export interface CodeStyle {
  theme?: string;
  fontSize?: number;
  lineNumbers?: boolean;
  highlightLines?: number[];
  borderRadius?: number;
}

export type ShapeKind = "rectangle" | "ellipse" | "line" | "arrow";

export type MarkerType = "none" | "arrow" | "circle";

export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  opacity?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  markerStart?: MarkerType;
  markerEnd?: MarkerType;
  path?: string;
  waypoints?: { x: number; y: number }[];
}

export interface VideoStyle {
  objectFit?: "contain" | "cover" | "fill";
  borderRadius?: number;
  crop?: CropRect;
}

export interface TikZStyle {
  backgroundColor?: string;
  borderRadius?: number;
}

export interface MermaidStyle {
  backgroundColor?: string;
  borderRadius?: number;
}

export interface TableStyle {
  fontSize?: number;
  color?: string;
  headerBackground?: string;
  headerColor?: string;
  borderColor?: string;
  striped?: boolean;
  borderRadius?: number;
}

// ----- Scene3D -----

export type Scene3DGeometry = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "line" | "surface";

export interface Scene3DSurface {
  fn: string;
  xRange?: [number, number];
  zRange?: [number, number];
  resolution?: number;
  colorRange?: [string, string];
}

export interface Scene3DMaterial {
  color?: string;
  opacity?: number;
  wireframe?: boolean;
  metalness?: number;
  roughness?: number;
  lineWidth?: number;
}

export interface Scene3DObject {
  id: string;
  geometry: Scene3DGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  material?: Scene3DMaterial;
  label?: string;
  visible?: boolean;
  points?: [number, number, number][];
  surface?: Scene3DSurface;
}

export interface Scene3DCamera {
  position: [number, number, number];
  target?: [number, number, number];
  fov?: number;
}

export interface Scene3DKeyframe {
  duration?: number;
  camera?: Partial<Scene3DCamera>;
  changes?: {
    target: string;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    material?: Partial<Scene3DMaterial>;
    visible?: boolean;
    points?: [number, number, number][];
    surface?: Partial<Scene3DSurface>;
  }[];
}

export interface Scene3DConfig {
  camera?: Scene3DCamera;
  background?: string;
  ambientLight?: number;
  directionalLight?: { position: [number, number, number]; intensity?: number };
  objects: Scene3DObject[];
  helpers?: { grid?: boolean; axes?: boolean };
  orbitControls?: boolean;
}

export interface Scene3DStyle {
  borderRadius?: number;
}

// ----- Elements -----

interface BaseElement {
  id: string;
  position: Position;
  size: Size;
  rotation?: number;
  groupId?: string;
}

export interface TextElement extends BaseElement {
  type: "text";
  content: string;
  style?: TextStyle;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  alt?: string;
  caption?: string;
  description?: string;
  aiSummary?: string;
  style?: ImageStyle;
}

export interface CodeElement extends BaseElement {
  type: "code";
  language: string;
  content: string;
  style?: CodeStyle;
}

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: ShapeKind;
  style?: ShapeStyle;
}

export interface VideoElement extends BaseElement {
  type: "video";
  src: string;
  alt?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  trimStart?: number;  // seconds, undefined = 0
  trimEnd?: number;    // seconds, undefined = full duration
  style?: VideoStyle;
}

export interface TikZElement extends BaseElement {
  type: "tikz";
  content: string;
  svgUrl?: string;
  preamble?: string;
  renderedContent?: string;
  renderedPreamble?: string;
  renderError?: string;
  style?: TikZStyle;
}

export interface TableElement extends BaseElement {
  type: "table";
  columns: string[];
  rows: string[][];
  style?: TableStyle;
}

export interface CustomElement extends BaseElement {
  type: "custom";
  component: string;
  props?: Record<string, unknown>;
}

export interface MermaidElement extends BaseElement {
  type: "mermaid";
  content: string;
  renderedSvg?: string;
  renderedContent?: string;
  renderError?: string;
  style?: MermaidStyle;
}

export interface Scene3DElement extends BaseElement {
  type: "scene3d";
  scene: Scene3DConfig;
  keyframes?: Scene3DKeyframe[];
  style?: Scene3DStyle;
}

export interface ReferenceElement extends BaseElement {
  type: "reference";
  componentId: string;
}

export type SlideElement = TextElement | ImageElement | CodeElement | ShapeElement | VideoElement | TikZElement | TableElement | CustomElement | Scene3DElement | MermaidElement | ReferenceElement;

// ----- Animations -----

export type AnimationTrigger = "onEnter" | "onClick" | "onKey" | "afterPrevious" | "withPrevious";

export type AnimationEffect =
  | "fadeIn"
  | "fadeOut"
  | "slideInLeft"
  | "slideInRight"
  | "slideInUp"
  | "slideInDown"
  | "scaleIn"
  | "scaleOut"
  | "typewriter"
  | "scene3dStep"
  | "playVideo";

export interface Animation {
  target: string;
  trigger: AnimationTrigger;
  effect: AnimationEffect;
  delay?: number;
  duration?: number;
  order?: number;
  key?: string;
}

// ----- Comments -----

export type CommentCategory = "content" | "design" | "bug" | "todo" | "question" | "done";

export interface Comment {
  id: string;
  elementId?: string;
  text: string;
  author?: string;
  category?: CommentCategory;
  createdAt: number;
}

// ----- Slide -----

export interface Slide {
  id: string;
  layout?: string;
  hidden?: boolean;
  hidePageNumber?: boolean;
  bookmark?: string;
  background?: SlideBackground;
  transition?: SlideTransition;
  notes?: string;
  elements: SlideElement[];
  animations?: Animation[];
  comments?: Comment[];
  /** Tracks external file origin when loaded from a $ref pointer */
  _ref?: string;
  /** Set when the $ref file is missing on disk */
  _missing?: boolean;
}

// ----- Page Numbers -----

export type PageNumberPosition =
  | "bottom-right"
  | "bottom-left"
  | "bottom-center"
  | "top-right"
  | "top-left"
  | "top-center";

export type PageNumberFormat = "number" | "number-total";

export interface PageNumberConfig {
  enabled: boolean;
  position?: PageNumberPosition;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  format?: PageNumberFormat;
  margin?: number;
  opacity?: number;
}

// ----- Theme -----

export interface DeckTheme {
  slide?: { background?: SlideBackground };
  text?: Partial<TextStyle>;
  code?: Partial<CodeStyle>;
  shape?: Partial<ShapeStyle>;
  image?: Partial<ImageStyle>;
  video?: Partial<VideoStyle>;
  tikz?: Partial<TikZStyle>;
  mermaid?: Partial<MermaidStyle>;
  table?: Partial<TableStyle>;
  scene3d?: Partial<Scene3DStyle>;
}

// ----- Shared Components -----

export interface SharedComponent {
  id: string;
  name: string;
  elements: SlideElement[];
}

// ----- Deck (top-level) -----

export interface DeckMeta {
  title: string;
  author?: string;
  aspectRatio: "16:9" | "4:3";
}

export interface Deck {
  deckode: string;
  meta: DeckMeta;
  theme?: DeckTheme;
  pageNumbers?: PageNumberConfig;
  components?: Record<string, SharedComponent>;
  slides: Slide[];
}

// ----- Virtual canvas constants -----

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;
