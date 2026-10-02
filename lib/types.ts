/**
 * The evidence model: everything the toolkit knows about a system, with the
 * file each fact came from. Adapters produce it; documents cite it. It is
 * platform-neutral so later adapters (L5X, other SCADA) reuse the publisher.
 * See docs/EVIDENCE.md.
 */

export const EVIDENCE_SCHEMA = "oic.docs.evidence/v0";
export const ENGINE_VERSION = "0.2.0";

export type EntityKind =
  | "gateway"
  | "project"
  | "page"
  | "view"
  | "style-class"
  | "script"
  | "event-script"
  | "named-query"
  | "tag-provider"
  | "tag-folder"
  | "tag"
  | "udt-type"
  | "udt-instance"
  | "alarm"
  | "opc-connection"
  | "database-connection"
  | "device"
  | "user-source"
  | "resource"
  // Supplied by a host (oic.docs.supplement/v0), never read from Ignition files:
  | "controller"
  | "plc-tag"
  | "io-point"
  | "disagreement"
  | "runtime-fact";

/** Scalar evidence values. Lists stay short; long text is truncated at extraction. */
export type FieldValue = string | number | boolean | null | string[];

/**
 * Fields that could disclose something about the site. Credentials are never
 * extracted at all; these are what the export redaction choices act on.
 */
export type Sensitivity = "address" | "username" | "code";

export interface SourceRef {
  /** Input the fact came from (file name as the user selected it). */
  input: string;
  /** Path inside the input, e.g. an archive entry. */
  path: string;
  /** Optional JSON pointer or line within that file. */
  at?: string;
}

export interface Entity {
  /** Stable across re-imports, e.g. `view:Riverbend/Pumps/Station`. */
  id: string;
  kind: EntityKind;
  name: string;
  /** Human path inside its scope (view path, tag path, …). */
  path?: string;
  /** Project, provider or gateway the entity belongs to. */
  scope?: string;
  source: SourceRef;
  fields: Record<string, FieldValue>;
  sensitive?: Record<string, Sensitivity>;
  /** False when the resource was listed but its content could not be read. */
  interpreted: boolean;
}

export type RelationshipType =
  | "routes-to" // page → view
  | "embeds-view" // view → view
  | "binds-tag" // view/script/tag → tag
  | "calls-query" // view/script → named query
  | "calls-script" // view/script → script module
  | "instance-of" // udt-instance → udt-type
  | "has-alarm" // tag → alarm
  | "uses-connection" // tag/query → connection
  | "contains" // project → resource
  // Supplied by a host (oic.docs.supplement/v0):
  | "reads-plc-tag" // tag → plc-tag (the OPC item path reads it)
  | "wired-to" // io-point → plc-tag
  | "concerns" // disagreement → either side, cited by its source
  | "about"; // runtime-fact → the entity it describes

export interface Relationship {
  from: string;
  /** Target entity id when resolved. */
  to?: string;
  type: RelationshipType;
  /** The reference as written in the source, e.g. a tag path. */
  target: string;
  /** Explicit = declared configuration (binding, route). Inferred = read from code or expressions. */
  explicit: boolean;
  /** Dynamic references (indirect bindings, parameters) can't be resolved statically. */
  dynamic?: boolean;
  source: SourceRef;
}

export type DiagnosticLevel = "info" | "warning" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  source?: SourceRef;
}

/** What was found versus what was actually read, per resource type. */
export interface CoverageItem {
  key: string;
  label: string;
  found: number;
  read: number;
  /** Why the difference exists, when there is one. */
  note?: string;
}

export interface InputRecord {
  name: string;
  size: number;
  sha256: string;
  format: InputFormat;
  adapter: string;
  adapterVersion: string;
  platformVersion?: string;
}

export type InputFormat = "ignition-gateway-backup" | "ignition-project-export" | "ignition-tag-json" | "oic-docs-supplement" | "unknown";

export interface Evidence {
  schema: typeof EVIDENCE_SCHEMA;
  engineVersion: string;
  inputs: InputRecord[];
  entities: Entity[];
  relationships: Relationship[];
  diagnostics: Diagnostic[];
  coverage: CoverageItem[];
}

export const emptyEvidence = (): Evidence => ({
  schema: EVIDENCE_SCHEMA,
  engineVersion: ENGINE_VERSION,
  inputs: [],
  entities: [],
  relationships: [],
  diagnostics: [],
  coverage: [],
});
