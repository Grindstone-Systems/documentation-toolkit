import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { zipOf } from "./helpers.ts";

/**
 * A synthetic Ignition 8.1 internal database (`db_backup_sqlite.idb`), built
 * from SQL with the same table and column shapes as a real 8.1 gateway, but
 * trimmed to what the adapter reads plus the credential columns it must not.
 * Everything is fictional (the Riverbend sample plant). Values starting with
 * `PLANTED-` are fake secrets that must never reach evidence.
 */

export const PLANTED = ["PLANTED-opc-password", "PLANTED-keystore-password", "PLANTED-db-password", "PLANTED-db-passworde", "PLANTED-props-password", "PLANTED-user-hash", "PLANTED-error-report-password"];

const SCHEMA = `
CREATE TABLE SYSPROPS ( "ID" NUMERIC(18,0) NOT NULL, "SYSTEMNAME" VARCHAR(4096) DEFAULT '' NOT NULL, "SYSTEMAUTHPROFILEID" NUMERIC(18,0) NOT NULL, "ERRORREPORTPASSWORD" VARCHAR(4096) DEFAULT '', CONSTRAINT PK_SYSPROPS PRIMARY KEY (ID) );
CREATE TABLE TAGPROVIDERSETTINGS ( "TAGPROVIDERSETTINGS_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) DEFAULT 'NewProvider' NOT NULL, "PROVIDERID" VARCHAR(4096) NOT NULL, "DESCRIPTION" VARCHAR(4096) DEFAULT '', "ENABLED" BOOLEAN DEFAULT 1, "TYPEID" VARCHAR(4096) NOT NULL, CONSTRAINT PK_TAGPROVIDERSETTINGS PRIMARY KEY (TAGPROVIDERSETTINGS_ID) );
CREATE TABLE SIMPLETAGPROVIDERPROFILE ( "NAME" VARCHAR(4096) NOT NULL, "PROVIDERID" NUMERIC(18,0), "NONUSECOUNT" INTEGER, CONSTRAINT PK_SIMPLETAGPROVIDERPROFILE PRIMARY KEY (NAME) );
CREATE TABLE INTERNALTAGPROVIDER ( "PROFILEID" NUMERIC(18,0) NOT NULL, "DEFAULTDATASOURCEID" NUMERIC(18,0), "READONLY" BOOLEAN DEFAULT 0, CONSTRAINT PK_INTERNALTAGPROVIDER PRIMARY KEY (PROFILEID) );
CREATE TABLE TAGCONFIG ( "ID" VARCHAR(4096) NOT NULL, "PROVIDERID" NUMERIC(18,0), "FOLDERID" VARCHAR(4096), "CFG" VARCHAR(268435455), "RANK" INTEGER DEFAULT 0, "NAME" VARCHAR(4096), CONSTRAINT PK_TAGCONFIG PRIMARY KEY (ID) );
CREATE TABLE TAGGROUPS ( "PROVIDERID" NUMERIC(18,0), "UUID" VARCHAR(4096) NOT NULL, "NAME" VARCHAR(4096), "CFG" VARCHAR(1048576), CONSTRAINT PK_TAGGROUPS PRIMARY KEY (UUID) );
CREATE TABLE OPCSERVERS ( "OPCSERVERS_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "TYPE" VARCHAR(4096) NOT NULL, "DESCRIPTION" VARCHAR(4096) DEFAULT '', "READONLY" BOOLEAN DEFAULT 0, CONSTRAINT PK_OPCSERVERS PRIMARY KEY (OPCSERVERS_ID) );
CREATE TABLE OPCUACONNECTIONSETTINGS ( "SERVERSETTINGSID" NUMERIC(18,0) NOT NULL, "ENABLED" BOOLEAN DEFAULT 1, "DISCOVERYURL" VARCHAR(4096), "ENDPOINTURL" VARCHAR(4096), "SECURITYPOLICY" VARCHAR(1024), "SECURITYMODE" VARCHAR(1024), "USERNAME" VARCHAR(4096), "PASSWORD" VARCHAR(4096), "HOSTOVERRIDE" VARCHAR(4096), "KEYSTOREALIAS" VARCHAR(4096) DEFAULT 'client', "KEYSTOREALIASPASSWORD" VARCHAR(4096), "FAILOVERENABLED" BOOLEAN DEFAULT 0, CONSTRAINT PK_OPCUACONNECTIONSETTINGS PRIMARY KEY (SERVERSETTINGSID) );
CREATE TABLE JDBCDRIVERS ( "JDBCDRIVERS_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "DBTYPE" VARCHAR(1024) DEFAULT 'GENERIC' NOT NULL, CONSTRAINT PK_JDBCDRIVERS PRIMARY KEY (JDBCDRIVERS_ID) );
CREATE TABLE DATASOURCES ( "DATASOURCES_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "DESCRIPTION" VARCHAR(4096) DEFAULT '', "DRIVERID" NUMERIC(18,0) NOT NULL, "CONNECTURL" VARCHAR(4096) DEFAULT '<missing>' NOT NULL, "USERNAME" VARCHAR(4096), "PASSWORD" VARCHAR(4096), "PASSWORDE" VARCHAR(4096), "CONNECTIONPROPS" VARCHAR(4096) DEFAULT '', "ENABLED" BOOLEAN DEFAULT 1, "POOLMAXACTIVE" INTEGER DEFAULT 8, "VALIDATIONQUERY" VARCHAR(4096) DEFAULT 'SELECT 1' NOT NULL, "FAILOVERPROFILEID" NUMERIC(18,0), CONSTRAINT PK_DATASOURCES PRIMARY KEY (DATASOURCES_ID) );
CREATE TABLE DEVICESETTINGS ( "DEVICESETTINGS_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "TYPE" VARCHAR(4096) NOT NULL, "DESCRIPTION" VARCHAR(4096) DEFAULT '', "ENABLED" BOOLEAN DEFAULT 1, CONSTRAINT PK_DEVICESETTINGS PRIMARY KEY (DEVICESETTINGS_ID) );
CREATE TABLE MODBUSTCPDRIVERSETTINGS ( "DEVICESETTINGSID" NUMERIC(18,0) NOT NULL, "HOSTNAME" VARCHAR(4096), "PORT" INTEGER DEFAULT 502, "LOCALADDRESS" VARCHAR(4096), CONSTRAINT PK_MODBUSTCPDRIVERSETTINGS PRIMARY KEY (DEVICESETTINGSID) );
CREATE TABLE LOGIXDRIVERSETTINGS ( "DEVICESETTINGSID" NUMERIC(18,0) NOT NULL, "HOSTNAME" VARCHAR(4096), "PORT" INTEGER DEFAULT 44818, "LOCALADDRESS" VARCHAR(4096), CONSTRAINT PK_LOGIXDRIVERSETTINGS PRIMARY KEY (DEVICESETTINGSID) );
CREATE TABLE PROGRAMMABLESIMSETTINGS ( "DEVICESETTINGSID" NUMERIC(18,0) NOT NULL, "REPEAT" BOOLEAN DEFAULT 1 NOT NULL, "INSTRUCTIONFILE" VARCHAR(2147483647) DEFAULT '', CONSTRAINT PK_PROGRAMMABLESIMSETTINGS PRIMARY KEY (DEVICESETTINGSID) );
CREATE TABLE AUTHPROFILES ( "AUTHPROFILES_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) DEFAULT 'NewProfile' NOT NULL, "TYPE" VARCHAR(4096) NOT NULL, "DESCRIPTION" VARCHAR(4096) DEFAULT '', "ENABLED" BOOLEAN DEFAULT 1, CONSTRAINT PK_AUTHPROFILES PRIMARY KEY (AUTHPROFILES_ID) );
CREATE TABLE INTERNALUSERTABLE ( "USERID" NUMERIC(18,0) NOT NULL, "PROFILEID" NUMERIC(18,0), "USERNAME" VARCHAR(4096) DEFAULT '' NOT NULL, "PASSWORD" VARCHAR(4096) NOT NULL, CONSTRAINT PK_INTERNALUSERTABLE PRIMARY KEY (USERID) );
CREATE TABLE ALARMJOURNALS ( "ALARMJOURNALS_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "TYPE" VARCHAR(4096) NOT NULL, "ENABLED" BOOLEAN DEFAULT 1, "DESCRIPTION" VARCHAR(4096), CONSTRAINT PK_ALARMJOURNALS PRIMARY KEY (ALARMJOURNALS_ID) );
CREATE TABLE SCHEDULE_PROFILES ( "SCHEDULE_PROFILES_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "TYPE" VARCHAR(4096) DEFAULT 'basic schedule' NOT NULL, "DESCRIPTION" VARCHAR(4096), CONSTRAINT PK_SCHEDULE_PROFILES PRIMARY KEY (SCHEDULE_PROFILES_ID) );
CREATE TABLE SECURITYZONES ( "SECURITYZONES_ID" NUMERIC(18,0) NOT NULL, "NAME" VARCHAR(4096) NOT NULL, "IP_ADDRESS" VARCHAR(4096), CONSTRAINT PK_SECURITYZONES PRIMARY KEY (SECURITYZONES_ID) );
CREATE TABLE IMAGES ( "PATH" VARCHAR(4096) NOT NULL, "TYPE" VARCHAR(1024), "DATA" BLOB, CONSTRAINT PK_IMAGES PRIMARY KEY (PATH) );
CREATE TABLE AUDITEVENTS ( "AUDIT_EVENTS_ID" NUMERIC(18,0) NOT NULL, "ACTION" VARCHAR(4096), CONSTRAINT PK_AUDITEVENTS PRIMARY KEY (AUDIT_EVENTS_ID) );
CREATE TABLE DNP3DRIVERSETTINGS ( "DEVICESETTINGSID" NUMERIC(18,0) NOT NULL, "HOSTNAME" VARCHAR(4096), CONSTRAINT PK_DNP3DRIVERSETTINGS PRIMARY KEY (DEVICESETTINGSID) );
`;

type Row = Record<string, string | number | null | Uint8Array>;

/** TAGCONFIG rows: id, provider, folder, config. Provider 2 is "Riverbend". */
function tagRows(): Row[] {
  const rows: Row[] = [];
  const tag = (ID: string, FOLDERID: string | null, cfg: object | string | null, PROVIDERID = 2) =>
    rows.push({ ID, PROVIDERID, FOLDERID, CFG: cfg === null || typeof cfg === "string" ? cfg : JSON.stringify(cfg), RANK: 0, NAME: cfg && typeof cfg === "object" && "name" in cfg ? String(cfg.name) : null });

  tag("f-intake", null, { name: "Intake", tagType: "Folder" });
  tag("f-pumps", null, { name: "Pumps", tagType: "Folder" });
  tag("f-bulk", null, { name: "Bulk", tagType: "Folder" });
  tag("t-rawflow", "f-intake", {
    name: "RawFlow",
    tagType: "AtomicTag",
    valueSource: "opc",
    dataType: "Float4",
    opcServer: "Ignition OPC UA Server",
    opcItemPath: "ns=1;s=[PLC_Intake]HR100",
    engUnit: "gpm",
    // Long enough to spill onto SQLite overflow pages.
    documentation: `Raw water flow from the river intake. ${"Measured at the intake flume. ".repeat(400)}`,
    alarms: [{ name: "High Flow", mode: "AboveValue", setpointA: 1200, priority: "High" }],
  });
  tag("t-totalflow", "f-intake", { name: "TotalFlow", tagType: "AtomicTag", valueSource: "expr", dataType: "Float8", expression: "{[Riverbend]Intake/RawFlow} * 1.0" });

  // UDT definition under _types_, with a member folder and a parameter-bound OPC path.
  tag("u-pump", "_types_", { name: "Pump", tagType: "UdtType", parameters: { PumpNum: { dataType: "Integer" } } });
  tag("u-pump.m-running", "u-pump", { name: "Running", tagType: "AtomicTag", valueSource: "opc", dataType: "Boolean", opcServer: "Ignition OPC UA Server", opcItemPath: { bindType: "parameter", binding: "ns=1;s=[PLC_Pumps]Pump{PumpNum}.Running" } });
  tag("u-pump.m-status", "u-pump", { name: "Status", tagType: "Folder" });
  tag("u-pump.m-fault", "u-pump.m-status", { name: "Fault", tagType: "AtomicTag", valueSource: "opc", dataType: "Boolean", opcServer: "Ignition OPC UA Server", opcItemPath: { bindType: "parameter", binding: "ns=1;s=[PLC_Pumps]Pump{PumpNum}.Fault" }, alarms: [{ name: "Pump Fault", mode: "Equality", setpointA: 1, priority: "High" }] });

  // Instances: P102 overrides one member, the way 8.1 stores overrides (`<instance>.<member>`, no name).
  tag("i-p101", "f-pumps", { name: "P101", tagType: "UdtInstance", typeId: "Pump", parameters: { PumpNum: { dataType: "Integer", value: 1 } } });
  tag("i-p102", "f-pumps", { name: "P102", tagType: "UdtInstance", typeId: "Pump", parameters: { PumpNum: { dataType: "Integer", value: 2 } } });
  tag("i-p102.m-running", "i-p102", { documentation: "Standby pump" });

  // Enough rows to need interior b-tree pages.
  for (let i = 0; i < 400; i++) tag(`b-${String(i).padStart(4, "0")}`, "f-bulk", { name: `Level${String(i).padStart(3, "0")}`, tagType: "AtomicTag", valueSource: "memory", dataType: "Int4" });

  // Rows that can't be placed: invalid JSON, no configuration, a missing parent folder.
  tag("x-bad", "f-intake", "{not json");
  tag("x-empty", "f-intake", null);
  tag("x-orphan", "f-gone", { name: "Lost", tagType: "AtomicTag", valueSource: "memory", dataType: "Int4" });

  // The System provider.
  tag("s-uptime", null, { name: "UptimeSeconds", tagType: "AtomicTag", valueSource: "memory", dataType: "Int8" }, 1);
  return rows;
}

const DATA: Record<string, Row[]> = {
  SYSPROPS: [{ ID: 1, SYSTEMNAME: "Riverbend-GW81", SYSTEMAUTHPROFILEID: 1, ERRORREPORTPASSWORD: "PLANTED-error-report-password" }],
  TAGPROVIDERSETTINGS: [
    { TAGPROVIDERSETTINGS_ID: 0, NAME: "default", PROVIDERID: "prov-0", DESCRIPTION: "", ENABLED: 1, TYPEID: "STANDARD" },
    { TAGPROVIDERSETTINGS_ID: 2, NAME: "Riverbend", PROVIDERID: "prov-2", DESCRIPTION: "Plant tags (fictional)", ENABLED: 1, TYPEID: "STANDARD" },
  ],
  SIMPLETAGPROVIDERPROFILE: [{ NAME: "System", PROVIDERID: 1, NONUSECOUNT: 0 }],
  INTERNALTAGPROVIDER: [{ PROFILEID: 2, DEFAULTDATASOURCEID: 1, READONLY: 1 }],
  TAGGROUPS: [{ PROVIDERID: 2, UUID: "g-default", NAME: "Default", CFG: JSON.stringify({ name: "Default", mode: "Direct", rate: 1000 }) }],
  OPCSERVERS: [{ OPCSERVERS_ID: 1, NAME: "Ignition OPC UA Server", TYPE: "com.inductiveautomation.OpcUaServerType", DESCRIPTION: "Loopback connection", READONLY: 0 }],
  OPCUACONNECTIONSETTINGS: [
    {
      SERVERSETTINGSID: 1,
      ENABLED: 1,
      DISCOVERYURL: "opc.tcp://localhost:62541/discovery",
      ENDPOINTURL: "opc.tcp://localhost:62541",
      SECURITYPOLICY: "Basic256Sha256",
      SECURITYMODE: "SignAndEncrypt",
      USERNAME: "opcuauser",
      PASSWORD: "PLANTED-opc-password",
      KEYSTOREALIASPASSWORD: "PLANTED-keystore-password",
    },
  ],
  JDBCDRIVERS: [{ JDBCDRIVERS_ID: 6, NAME: "Microsoft SQLServer JDBC Driver", DBTYPE: "MSSQL" }],
  DATASOURCES: [
    {
      DATASOURCES_ID: 1,
      NAME: "RiverbendSQL",
      DESCRIPTION: "Historian and maintenance database (fictional)",
      DRIVERID: 6,
      CONNECTURL: "jdbc:sqlserver://sql01.riverbend.example:1433;databaseName=Riverbend",
      USERNAME: "svc_ignition",
      PASSWORD: "PLANTED-db-password",
      PASSWORDE: "PLANTED-db-passworde",
      CONNECTIONPROPS: "password=PLANTED-props-password",
      ENABLED: 1,
      POOLMAXACTIVE: 8,
      VALIDATIONQUERY: "SELECT 1",
    },
  ],
  DEVICESETTINGS: [
    { DEVICESETTINGS_ID: 1, NAME: "PLC_Intake", TYPE: "ModbusTcp", DESCRIPTION: "Intake PLC (fictional)", ENABLED: 1 },
    { DEVICESETTINGS_ID: 2, NAME: "PLC_Pumps", TYPE: "LogixDriver", DESCRIPTION: "", ENABLED: 0 },
    { DEVICESETTINGS_ID: 3, NAME: "Sim_Lab", TYPE: "ProgrammableSimulatorDevice", DESCRIPTION: "", ENABLED: 1 },
  ],
  MODBUSTCPDRIVERSETTINGS: [{ DEVICESETTINGSID: 1, HOSTNAME: "10.20.1.21", PORT: 502 }],
  LOGIXDRIVERSETTINGS: [{ DEVICESETTINGSID: 2, HOSTNAME: "10.20.1.23", PORT: 44818 }],
  PROGRAMMABLESIMSETTINGS: [{ DEVICESETTINGSID: 3, REPEAT: 1, INSTRUCTIONFILE: "0,Ramp,0,100" }],
  AUTHPROFILES: [{ AUTHPROFILES_ID: 1, NAME: "default", TYPE: "INTERNAL", DESCRIPTION: "", ENABLED: 1 }],
  INTERNALUSERTABLE: [{ USERID: 1, PROFILEID: 1, USERNAME: "operator1", PASSWORD: "PLANTED-user-hash" }],
  ALARMJOURNALS: [{ ALARMJOURNALS_ID: 1, NAME: "Journal", TYPE: "DATASOURCE", ENABLED: 1, DESCRIPTION: null }],
  SCHEDULE_PROFILES: [{ SCHEDULE_PROFILES_ID: 1, NAME: "Weekday Day Shift", TYPE: "basic schedule", DESCRIPTION: null }],
  SECURITYZONES: [{ SECURITYZONES_ID: 1, NAME: "Plant Floor", IP_ADDRESS: "10.20.*" }],
  IMAGES: [{ PATH: "Builtin/icons/pump.png", TYPE: "png", DATA: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }],
  AUDITEVENTS: [{ AUDIT_EVENTS_ID: 1, ACTION: "config save" }],
};

/** Build the database and return its bytes. */
export function makeIdb81(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "oic-idb81-"));
  try {
    const file = join(dir, "db_backup_sqlite.idb");
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    const insert = (table: string, rows: Row[]) => {
      for (const r of rows) {
        const cols = Object.keys(r);
        db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => r[c]!));
      }
    };
    for (const [table, rows] of Object.entries(DATA)) insert(table, rows);
    insert("TAGCONFIG", tagRows());
    db.close();
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A synthetic 8.1 gateway backup: backupinfo.xml, one project and the internal database. */
export function makeBackup81(idb = makeIdb81()): Uint8Array {
  return zipOf({
    "backupinfo.xml": "<gateway-backup><version>8.1.45.2025010709</version><timestamp>2026-09-29 09:00:00</timestamp><backup-type>DATA_ONLY</backup-type></gateway-backup>",
    "db_backup_sqlite.idb": idb,
    "gateway.xml": "<gateway/>",
    "projects/Riverbend/project.json": JSON.stringify({ title: "Riverbend" }),
    "projects/Riverbend/com.inductiveautomation.perspective/views/Main/resource.json": "{}",
    "projects/Riverbend/com.inductiveautomation.perspective/views/Main/view.json": JSON.stringify({
      root: { type: "ia.container.flex", meta: { name: "root" }, children: [{ type: "ia.display.label", meta: { name: "Flow" }, propConfig: { "props.text": { binding: { type: "tag", config: { tagPath: "[Riverbend]Intake/RawFlow" } } } } }] },
    }),
  });
}
