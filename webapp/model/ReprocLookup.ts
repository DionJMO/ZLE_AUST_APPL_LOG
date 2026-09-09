import ODataModel from "sap/ui/model/odata/v4/ODataModel";

/**
 * Arbeitsvorrat als Nachschlagewerk zur Meldungsliste.
 *
 * WARUM ALS SPALTE UND NICHT ALS REITER (Festlegung Maring, 03.09.2026)
 * Der Arbeitsvorrat hatte bis 02.09. einen eigenen Reiter mit eigener
 * Tabelle. Fachlich gehoert er aber an die Meldung: wer einen Fehler liest,
 * will von dort aus anstossen und nicht erst den Schluessel merken und den
 * Reiter wechseln.
 *
 * 🔴 DER SCHLUESSEL IST NICHT EINDEUTIG, und daraus folgt die ganze Bauform.
 * ZLE_AUST_REPROC hat den Schluessel ACTION + BUSINESS_KEY. Zu EINEM
 * Business-Key koennen also mehrere Saetze gehoeren - Anlage, Storno und
 * Quittierung derselben TA-Position. Eine Logzeile traegt dagegen nur den
 * BUSINESS_KEY und KEINE Aktion.
 *
 * Deshalb liefert das Nachschlagewerk je Schluessel eine LISTE, und die
 * Spalte zeigt nur eine Zusammenfassung. Welche Aktion angestossen wird,
 * entscheidet der Anwender im Popover - geraten wird hier nichts. Das ist
 * dieselbe Regel wie in O-25: zuordnen ja, falsch zuordnen nie.
 *
 * ⚠ Geladen wird nur, was Handlungsbedarf hat (Status <> 'D' und <> 'C').
 * Erledigtes im Nachschlagewerk waere Ballast: die Spalte soll zeigen, wo
 * etwas zu tun ist.
 */

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const MAX_ROWS = 2000;

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const OPEN_FILTER = "Status ne 'D' and Status ne 'C'";

export interface ReprocEntry {
	Action: string;
	ActionText: string;
	BusinessKey: string;
	Status: string;
	StatusCriticality: number;
	TryCount: number;
	MaxCount: number;
	LastTryAt: string;
	LastMsg: string;
}

export interface ReprocResult {
	/** Business-Key -> alle offenen Saetze dazu. */
	map: Record<string, ReprocEntry[]>;
	/** Wurde die Leseobergrenze erreicht? */
	truncated: boolean;
	/** Hat die Abfrage ueberhaupt stattgefunden? */
	ok: boolean;
	/** Anzahl offener Saetze insgesamt. */
	total: number;
}

/**
 * Wie in model/TaPositions.ts: nur Zeichenketten, Zahlen und Wahrheitswerte
 * werden umgewandelt. Ein String( ) auf ein Objekt ergaebe
 * "[object Object]" - besser leer als ein Platzhalter, der wie ein Wert
 * aussieht.
 */
function text(vValue: unknown): string {
	if (typeof vValue === "string") {
		return vValue;
	}
	if (typeof vValue === "number" || typeof vValue === "boolean") {
		return String(vValue);
	}
	return "";
}

function num(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Laedt die offenen Arbeitsvorrats-Saetze und gruppiert sie nach
 * Business-Key.
 *
 * ⚠ `ok` unterscheidet "geprueft, nichts offen" von "nicht geprueft". Ohne
 * das zeigte eine leere Spalte Entwarnung, wo gar keine Aussage vorliegt -
 * derselbe Fehler, der bei der WA-Pruefung schon einmal drinsteckte.
 */
export async function load(oModel: ODataModel | undefined): Promise<ReprocResult> {
	const oResult: ReprocResult = { map: {}, truncated: false, ok: false, total: 0 };
	if (!oModel) {
		// eslint-disable-next-line no-console
		console.error("[Arbeitsvorrat] Modell reprocModel nicht vorhanden");
		return oResult;
	}

	try {
		const oBinding = oModel.bindList("/Reproc", undefined, [], [], {
			$filter: OPEN_FILTER,
			$orderby: "LastTryAt desc"
		});
		const aContexts = await oBinding.requestContexts(0, MAX_ROWS);

		aContexts.forEach((oContext) => {
			const o = oContext.getObject() as Record<string, unknown>;
			const sKey = text(o.BusinessKey).trim();
			if (!sKey) {
				return;
			}
			const oEntry: ReprocEntry = {
				Action: text(o.Action).trim(),
				ActionText: text(o.ActionText).trim(),
				BusinessKey: sKey,
				Status: text(o.Status).trim(),
				StatusCriticality: num(o.StatusCriticality),
				TryCount: num(o.TryCount),
				MaxCount: num(o.MaxCount),
				LastTryAt: text(o.LastTryAt),
				LastMsg: text(o.LastMsg).trim()
			};
			(oResult.map[sKey] ??= []).push(oEntry);
			oResult.total += 1;
		});

		oResult.truncated = aContexts.length >= MAX_ROWS;
		oResult.ok = true;
	} catch (oError) {
		// eslint-disable-next-line no-console
		console.error("[Arbeitsvorrat] Laden fehlgeschlagen:", oError);
	}

	return oResult;
}
