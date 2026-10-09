import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";

/**
 * HiLIS-Verbindungsstatus fuer die Kopfzeile (Anstoss Gollmer/Tolksdorf,
 * 09.10.2026).
 *
 * WOHER DIE AUSSAGE KOMMT
 * Die Pruefung laeuft im BACKEND - Custom Entity ZLE_AUST_C_HILIS_CONN mit
 * Query-Provider ZCL_ZLE_AUST_CONN_CHECK im Lookup-Service. Sie geht
 * denselben Weg wie die echten Aufrufe: ZLE_AUST_CONCONF (eigene SYSID) ->
 * SM59-Destination -> JWT-Anmeldung -> je HiLIS-Endpunkt ein lesender
 * Aufruf. Aus dem Browser liesse sich das nicht pruefen: HiLIS steht auf
 * einem anderen Host (CORS), und die Zugangsdaten liegen nur in SAP.
 *
 * Anlass war Q01 am 09.10.: nach dem Import fehlte die Destination, jeder
 * Aufruf scheiterte mit "HTTP-Client - Kommunikationsfehler" - und das
 * Monitoring zeigte davon nichts.
 *
 * DIE GEGENRICHTUNG (HiLIS -> SAP) kann SAP nicht aktiv pruefen. Ersatz ist
 * die juengste Rueckmeldung im Log (*_CONFIRM_IN): bleibt sie aus, obwohl
 * Auftraege offen sind, ist das der Hinweis.
 *
 * WIE OFT
 * Jede Pruefung meldet sich bei HiLIS an und ruft sechs Endpunkte. Deshalb
 * nicht im 30-Sekunden-Takt des Live-Modus, sondern hoechstens alle
 * MIN_AGE_MS - plus auf Knopfdruck im Popover.
 */

/** Mindestabstand zwischen zwei automatischen Pruefungen. */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const MIN_AGE_MS = 5 * 60 * 1000;

/** Prozesse, deren Logzeilen eine Rueckmeldung von HiLIS sind. */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const CALLBACK_TYPES = ["IB_CONFIRM_IN", "OB_CONFIRM_IN"];

/** "unreadable": die Pruefung selbst war nicht lesbar - ueber HiLIS ist nichts gesagt. */
export type ConnState = "ok" | "warning" | "error" | "unknown" | "unreadable";

export interface ConnStep {
	StepNo: number;
	StepGroup: string;
	StepName: string;
	CheckResult: string;
	ResultCriticality: number;
	HttpStatus: number;
	DurationMs: number;
	Hint: string;
	Target: string;
	CheckedAt: string;
}

export interface LastCallback {
	at: string;
	historyType: string;
	key: string;
}

export interface ConnResult {
	/** Hat die Pruefung selbst geantwortet? Sonst ist state "unknown". */
	ok: boolean;
	error: string;
	state: ConnState;
	/** 3/2/1/0 - passt zu formatter.criticalityState/-Icon. */
	criticality: number;
	base: ConnStep[];
	endpoints: ConnStep[];
	/** Anzahl der Schritte mit W oder E. */
	failing: number;
	checkedAt: string;
	/** Name des ersten gestoerten Schritts, fuer das Hinweisband. */
	firstProblem: string;
	lastCallback: LastCallback | null;
}

function text(v: unknown): string {
	if (typeof v === "string") {
		return v;
	}
	if (typeof v === "number" || typeof v === "boolean") {
		return String(v);
	}
	return "";
}

function num(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Startzustand des JSON-Modells "conn" - vor der ersten Pruefung.
 *
 * busy = true, damit die Kopfzeile von Anfang an "wird geprueft" zeigt und
 * nicht kurz "nicht pruefbar".
 */
export function emptyState(): ConnResult & { busy: boolean } {
	return {
		ok: false, error: "", state: "unknown", criticality: 0, base: [], endpoints: [],
		failing: 0, checkedAt: "", firstProblem: "", lastCallback: null, busy: true
	};
}

/** E schlaegt W schlaegt O; ohne Schritte gibt es keine Aussage. */
export function stateOf(aSteps: ConnStep[]): ConnState {
	if (!aSteps.length) {
		return "unknown";
	}
	if (aSteps.some((o) => o.CheckResult === "E")) {
		return "error";
	}
	if (aSteps.some((o) => o.CheckResult === "W")) {
		return "warning";
	}
	return "ok";
}

export function criticalityOf(sState: ConnState): number {
	switch (sState) {
		case "ok": return 3;
		case "warning": return 2;
		case "error": return 1;
		default: return 0;
	}
}

/**
 * Fuehrt die Backend-Pruefung aus.
 *
 * ⚠ `ok` unterscheidet "geprueft" von "Pruefung nicht lesbar" - dieselbe
 * Regel wie im Arbeitsvorrat: ein Ausfall des Service darf nicht wie
 * Entwarnung aussehen.
 */
export async function load(oModel: ODataModel | undefined): Promise<ConnResult> {
	const oResult: ConnResult = {
		ok: false, error: "", state: "unknown", criticality: 0, base: [], endpoints: [],
		failing: 0, checkedAt: "", firstProblem: "", lastCallback: null
	};
	if (!oModel) {
		oResult.error = "Modell lookupModel nicht vorhanden";
		oResult.state = "unreadable";
		return oResult;
	}
	try {
		const oBinding = oModel.bindList("/HilisConnection", undefined, [new Sorter("StepNo")]);
		const aContexts = await oBinding.requestContexts(0, 50);
		const aSteps = aContexts.map((oContext): ConnStep => {
			const o = oContext.getObject() as Record<string, unknown>;
			return {
				StepNo: num(o.StepNo),
				StepGroup: text(o.StepGroup).trim(),
				StepName: text(o.StepName).trim(),
				CheckResult: text(o.CheckResult).trim(),
				ResultCriticality: num(o.ResultCriticality),
				HttpStatus: num(o.HttpStatus),
				DurationMs: num(o.DurationMs),
				Hint: text(o.Hint).trim(),
				Target: text(o.Target).trim(),
				CheckedAt: text(o.CheckedAt)
			};
		});
		oResult.base = aSteps.filter((o) => o.StepGroup !== "ENDPUNKT");
		oResult.endpoints = aSteps.filter((o) => o.StepGroup === "ENDPUNKT");
		oResult.state = stateOf(aSteps);
		oResult.criticality = criticalityOf(oResult.state);
		oResult.failing = aSteps.filter((o) => o.CheckResult !== "O").length;
		oResult.firstProblem = aSteps.find((o) => o.CheckResult !== "O")?.StepName ?? "";
		oResult.checkedAt = aSteps[0]?.CheckedAt ?? new Date().toISOString();
		oResult.ok = true;
	} catch (oError) {
		// eslint-disable-next-line no-console
		console.error("[HiLIS-Verbindung] Pruefung nicht lesbar:", oError);
		oResult.error = (oError as Error)?.message ?? "";
		oResult.state = "unreadable";
		oResult.checkedAt = new Date().toISOString();
	}
	return oResult;
}

/**
 * Juengste Rueckmeldung von HiLIS im Log - die einzige Sicht auf die
 * Richtung HiLIS -> SAP.
 *
 * Zwei EQ-Filter statt endswith: endswith haengt an der Filterfaehigkeit
 * des RAP-Service, EQ nicht.
 */
export async function loadLastCallback(oModel: ODataModel | undefined): Promise<LastCallback | null> {
	if (!oModel) {
		return null;
	}
	try {
		const oFilter = new Filter({
			and: false,
			filters: CALLBACK_TYPES.map((s) => new Filter("HistoryType", FilterOperator.EQ, s))
		});
		const oBinding = oModel.bindList("/AppLog", undefined,
			[new Sorter("CreatedAtStamp", true)], [oFilter],
			{ $select: "CreatedAtStamp,HistoryType,BusinessKey,TpaNumber" });
		const [oContext] = await oBinding.requestContexts(0, 1);
		if (!oContext) {
			return null;
		}
		const o = oContext.getObject() as Record<string, unknown>;
		return {
			at: text(o.CreatedAtStamp),
			historyType: text(o.HistoryType).trim(),
			key: (text(o.BusinessKey) || text(o.TpaNumber)).trim()
		};
	} catch (oError) {
		// eslint-disable-next-line no-console
		console.error("[HiLIS-Verbindung] Letzte Rueckmeldung nicht lesbar:", oError);
		return null;
	}
}
