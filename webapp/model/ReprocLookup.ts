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
 * 🔴 SEIT 11.09.2026 WERDEN AUCH ERLEDIGTE SAETZE GELADEN.
 *
 * Vorher stand hier ein Filter "Status ne 'D' and Status ne 'C'" mit der
 * Begruendung, Erledigtes sei Ballast. Fuer die Frage "wo ist etwas zu tun"
 * stimmte das - nur macht derselbe Filter die zweite Frage UNBEANTWORTBAR:
 * „mit der Reproc-Tabelle abgleichen, dass Fehler behoben sind". Ein Fehler,
 * den das Reprocessing im Hintergrund geradegezogen hat, war in der App per
 * Konstruktion unsichtbar.
 *
 * Deshalb jetzt ZWEI Karten aus EINER Abfrage:
 *   map       offen / laufend / gescheitert -> traegt den Wiederanstoss
 *   mapDone   erledigt (D) und manuell erledigt (C) -> traegt das
 *             Erledigt-Kennzeichen am Vorgang
 *
 * Sie bleiben getrennt, weil sie verschiedene Dinge bedeuten: aus map folgt
 * eine Handlung, aus mapDone eine Auskunft.
 */

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const MAX_ROWS = 5000;

/**
 * Status, die als ERLEDIGT gelten.
 *
 * 'D' setzt der Dispatcher nach einem erfolgreichen Wiederanstoss, 'C' ein
 * Mensch, der den Fall von Hand geklaert hat. Fuer den Abgleich sind beide
 * dasselbe: der Fehler steht nicht mehr an.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const DONE_STATUS = ["D", "C"];

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
	/** Business-Key -> alle OFFENEN Saetze dazu. Traegt den Wiederanstoss. */
	map: Record<string, ReprocEntry[]>;
	/**
	 * Business-Key -> die ERLEDIGTEN Saetze dazu (Status D oder C).
	 * Traegt das Erledigt-Kennzeichen am Vorgang - der Abgleich zwischen Log
	 * und Arbeitsvorrat.
	 */
	mapDone: Record<string, ReprocEntry[]>;
	/** Wurde die Leseobergrenze erreicht? */
	truncated: boolean;
	/**
	 * Hat die Abfrage ueberhaupt stattgefunden?
	 *
	 * 🔴 Die Unterscheidung "geprueft, nichts offen" gegen "nicht geprueft"
	 * ist der Kern von Punkt 4: schlaegt das Laden fehl, ist die Karte leer,
	 * und OHNE dieses Kennzeichen sieht das in der Oberflaeche genauso aus
	 * wie ein Vorgang ohne Arbeitsvorrats-Satz - man klickt, und nichts
	 * passiert.
	 */
	ok: boolean;
	/** Grund des Fehlschlags, fuer den Hinweis in der Oberflaeche. */
	error: string;
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
 * Laedt den Arbeitsvorrat und gruppiert ihn nach Business-Key - offene und
 * erledigte Saetze getrennt.
 *
 * ⚠ `ok` unterscheidet "geprueft, nichts offen" von "nicht geprueft". Ohne
 * das zeigte eine leere Spalte Entwarnung, wo gar keine Aussage vorliegt -
 * derselbe Fehler, der bei der WA-Pruefung schon einmal drinsteckte, und die
 * Haelfte von Punkt 4 ("Knopf reagiert nicht").
 */
export async function load(oModel: ODataModel | undefined): Promise<ReprocResult> {
	const oResult: ReprocResult = {
		map: {}, mapDone: {}, truncated: false, ok: false, error: "", total: 0
	};
	if (!oModel) {
		// eslint-disable-next-line no-console
		console.error("[Arbeitsvorrat] Modell reprocModel nicht vorhanden");
		oResult.error = "Modell reprocModel nicht vorhanden";
		return oResult;
	}

	try {
		/*
		 * OHNE Statusfilter - erledigte Saetze sind hier das Ziel, nicht
		 * Ballast (s. Kopfkommentar). Sortiert nach dem letzten Versuch,
		 * damit bei erreichter Obergrenze das Juengste drin ist.
		 */
		const oBinding = oModel.bindList("/Reproc", undefined, [], [], {
			$orderby: "LastTryAt desc"
		});
		const aContexts = await oBinding.requestContexts(0, MAX_ROWS);

		aContexts.forEach((oContext) => {
			const o = oContext.getObject() as Record<string, unknown>;
			const sKey = text(o.BusinessKey).trim();
			if (!sKey) {
				return;
			}
			const sStatus = text(o.Status).trim().toUpperCase();
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
			if (DONE_STATUS.includes(sStatus)) {
				(oResult.mapDone[sKey] ??= []).push(oEntry);
				return;
			}
			(oResult.map[sKey] ??= []).push(oEntry);
			oResult.total += 1;
		});

		oResult.truncated = aContexts.length >= MAX_ROWS;
		oResult.ok = true;
	} catch (oError) {
		// eslint-disable-next-line no-console
		console.error("[Arbeitsvorrat] Laden fehlgeschlagen:", oError);
		/*
		 * Der Grund wandert mit nach draussen. Bis 11.09.2026 blieb er in der
		 * Browserkonsole, und die Oberflaeche zeigte denselben Zustand wie
		 * "nichts offen" - ein Ausfall des Service sah aus wie Ruhe. Genau
		 * das ist die wahrscheinlichste Ursache von Punkt 4.
		 */
		oResult.error = (oError as Error)?.message ?? "";
	}

	return oResult;
}
