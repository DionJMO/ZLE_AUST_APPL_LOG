import ODataModel from "sap/ui/model/odata/v4/ODataModel";

/**
 * TA-Positionen aus LTAK/LTAP ueber den Lookup-Service.
 *
 * Zwei Verwendungen, eine Quelle:
 *
 *   loadByOrders( )   reichert die Auftragstabelle um MHD und ME an - beides
 *                     Felder, die ZLE_AUST_TPA_SYNC NIE fuellt (sie kommen
 *                     nicht aus GET_ORDER_LIST) und die die Anforderung F-01
 *                     ausdruecklich verlangt.
 *
 *   loadAutoStore( )  liefert die AS-Positionen eines Zeitfensters fuer die
 *   + shadowedPicks( ) Vollstaendigkeitspruefung Warenausgang.
 *
 * ⚠ WARUM DIE PRUEFUNG NICHT UEBER DEN LOG GEHT: naheliegend waere "AS-Pick-
 * Position in SAP, aber kein Logeintrag -> nie gesendet". Das traegt NICHT.
 * Der Outbound-Pfad protokolliert Erfolge ueberhaupt nicht (in send_order
 * steht nach create_order kein log_msg) - ein fehlender Eintrag ist also der
 * Normalfall und kein Befund. Deshalb wird hier ausschliesslich gegen die
 * SAP-Daten geprueft.
 */

/*
 * Konstanten eines ES-Moduls, keine globalen Bezeichner - gleiche Ausnahme
 * wie in model/ProcessAxis.ts und model/formatter.ts.
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
/**
 * Wie viele TA-Nummern in EINEN Filter gepackt werden.
 *
 * ⚠ Nicht kosmetisch: der Filter landet als Query-String in der URL, und die
 * ist bei Gateway und Proxy laengenbegrenzt. 50 Nummern zu je ~25 Zeichen
 * Ausdruck bleiben deutlich darunter.
 */
const CHUNK = 50;
/** Obergrenze fuer die Anreicherung - so viele Positionen werden gelesen. */
const MAX_POS = 2000;
/** Obergrenze fuer die AS-Sicht. Wird sie erreicht, sagt es die Oberflaeche. */
export const MAX_AS = 3000;
/** Die Lagernummer des AutoStore - zugleich das fuehrende Schluesselfeld von LTAP. */
const LGNUM = "001";
/** Lagertyp des AutoStore, wie in den Trigger-Klassen. */
const AS_TYPE = "AS";
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

export interface TaPos {
	TransferOrder?: string;
	TransferOrderItem?: string;
	Material?: string;
	MaterialName?: string;
	AlternativeUnit?: string;
	ShelfLifeExpirationDate?: string;
	GoodsReceiptDate?: string;
	Batch?: string;
	IsAutoStorePick?: unknown;
	IsAutoStorePutAway?: unknown;
	ItemIsConfirmed?: unknown;
	CreationDate?: string;
	DestTargetQtyInAltUnit?: string | number;
}

/**
 * Ergebnis eines Lesevorgangs samt Kappungshinweis.
 *
 * ⚠ KEINE STILLEN DECKEL - die Regel steht so im Projekt und wird von
 * LogAggregator und CascadeGrouper bereits eingehalten. Eine gekappte Menge
 * ohne Hinweis liest sich wie eine vollstaendige, und gerade bei einer
 * VOLLSTAENDIGKEITSpruefung waere das der schlimmste Fehler: sie behauptete
 * dann, es gebe keine weiteren Faelle.
 */
export interface TaPosResult {
	rows: TaPos[];
	truncated: boolean;
	/**
	 * Hat die Abfrage ueberhaupt STATTGEFUNDEN?
	 *
	 * 🔴 OHNE DAS IST EINE 0 NICHT LESBAR. "Keine betroffenen Auftraege" und
	 * "nicht geprueft" sehen in einer leeren Tabelle gleich aus - und bei
	 * einer VOLLSTAENDIGKEITSpruefung ist das der gefaehrlichste aller
	 * Zustaende: die Oberflaeche behauptet Entwarnung, wo sie keine Aussage
	 * hat.
	 */
	ok: boolean;
}

/** Eine TA, deren Pick-Auftrag nicht ausgeloest werden kann. */
export interface ShadowedPick {
	TransferOrder: string;
	CreationDate: string;
	/** Positionen mit VLTYP = 'AS' - die, die HiLIS nie erreichen. */
	PickItems: number;
	/** Positionen mit NLTYP = 'AS' - die, die den Trigger belegen. */
	PutAwayItems: number;
	/** Materialien der betroffenen Pick-Positionen, fuer die Anzeige. */
	Materials: string;
	/** true, wenn mindestens eine Position beides ist (VLTYP = NLTYP = 'AS'). */
	HasBoth: boolean;
}

/**
 * Kennzeichen gesetzt?
 *
 * Wie in SapLookup: SADL bildet XFELD-Domaenen auf Edm.Boolean ab, aus einem
 * nicht gesetzten Kennzeichen wird dann false - und String(false) ist ein
 * NICHT leerer String. Eine Pruefung auf "nicht leer" kehrte sich damit um.
 */
function isFlagged(vValue: unknown): boolean {
	if (typeof vValue === "boolean") {
		return vValue;
	}
	if (typeof vValue === "number") {
		return vValue !== 0;
	}
	if (typeof vValue !== "string") {
		return false;
	}
	const sValue = vValue.trim().toLowerCase();
	return sValue !== "" && sValue !== "false" && sValue !== "0";
}

function literal(sValue: string): string {
	return `'${sValue.replace(/'/g, "''")}'`;
}

function text(vValue: unknown): string {
	if (typeof vValue === "string") {
		return vValue;
	}
	if (typeof vValue === "number" || typeof vValue === "boolean") {
		return String(vValue);
	}
	return "";
}

async function fetchRows(
	oModel: ODataModel,
	sFilter: string,
	iMax: number
): Promise<TaPos[]> {
	const oBinding = oModel.bindList("/TransferOrderItem", undefined, [], [], { $filter: sFilter });
	const aContexts = await oBinding.requestContexts(0, iMax);
	return aContexts.map((oContext) => oContext.getObject() as TaPos);
}

/**
 * Schluessel der Zuordnung Puffer <-> TA-Position.
 *
 * ⚠ Die Positionsnummer wird NUMERISCH normiert. ZLE_AUST_TPA traegt sie als
 * "1" (aus |{ tapos alpha = out }|), LTAP als NUMC4, also "0001". Ein
 * Zeichenvergleich fande nie einen Treffer - derselbe Fehlertyp wie bei
 * Ursache D von Punkt 15.
 */
export function posKey(sOrder: string, vItem: string | number | null | undefined): string {
	const sOrd = (sOrder ?? "").trim();
	const nItem = Number(String(vItem ?? "").trim());
	return `${sOrd}/${Number.isNaN(nItem) ? String(vItem ?? "").trim() : String(nItem)}`;
}

/**
 * Liest die TA-Positionen zu einer Menge von TA-Nummern und liefert sie als
 * Nachschlagewerk, Schluessel siehe posKey( ).
 *
 * Faellt der Service aus, kommt ein leeres Objekt zurueck - die Spalten
 * bleiben dann leer wie vorher, die Tabelle bricht nicht.
 */
export async function loadByOrders(
	oModel: ODataModel | undefined,
	aOrders: string[]
): Promise<{ map: Record<string, TaPos>; truncated: boolean }> {
	const mResult: Record<string, TaPos> = {};
	let bTruncated = false;
	if (!oModel || !aOrders.length) {
		return { map: mResult, truncated: false };
	}

	const aUnique = Array.from(new Set(aOrders.map((s) => (s ?? "").trim()).filter((s) => s)));

	try {
		for (let i = 0; i < aUnique.length; i += CHUNK) {
			const aChunk = aUnique.slice(i, i + CHUNK);
			const sFilter = aChunk.map((s) => `TransferOrder eq ${literal(s)}`).join(" or ");
			const aRows = await fetchRows(oModel, sFilter, MAX_POS);
			bTruncated = bTruncated || aRows.length >= MAX_POS;
			aRows.forEach((oRow) => {
				mResult[posKey(text(oRow.TransferOrder), oRow.TransferOrderItem)] = oRow;
			});
		}
	} catch {
		// Kein Wurf nach aussen: die Anreicherung ist eine Zugabe, kein
		// Bestandteil der Tabelle.
		return { map: mResult, truncated: bTruncated };
	}

	return { map: mResult, truncated: bTruncated };
}

/**
 * Liest alle AutoStore-Positionen ab einem Datum (ISO, YYYY-MM-DD).
 *
 * Meldet ueber `truncated` mit, ob die Obergrenze erreicht wurde - dann ist
 * die Pruefung unvollstaendig und darf nicht als "nichts gefunden" gelesen
 * werden.
 */
export async function loadAutoStore(
	oModel: ODataModel | undefined,
	sFromDate: string
): Promise<TaPosResult> {
	if (!oModel) {
		/*
		 * ⚠ AUCH DAS PROTOKOLLIEREN. Dieser Zweig war der einzige stille Weg
		 * zu ok = false - und genau er hat zugeschlagen, als der Aufrufer das
		 * Modell ueber die View statt ueber die Component holte. Die Konsole
		 * blieb leer, obwohl der Leerzustand auf sie verwies.
		 */
		// eslint-disable-next-line no-console
		console.error("[WA-Pruefung] Lookup-Modell nicht verfuegbar - Abfrage nicht gestellt.");
		return { rows: [], truncated: false, ok: false };
	}
	/*
	 * 🔴 GEFILTERT WIRD AUF DIE ECHTEN LAGERTYPEN, NICHT AUF DIE BERECHNETEN
	 * KENNZEICHEN. Der erste Anlauf tat das und wurde ABGEWIESEN - beide
	 * Schreibweisen (eq true und eq 'X'), was den Typ als Ursache ausschliesst.
	 *
	 * SourceStorageType / DestStorageType sind LTAP-VLTYP und -NLTYP, also
	 * echte CHAR-Felder. Das loest drei Probleme auf einmal:
	 *
	 *   1. KEINE TYPFRAGE mehr. IsAutoStorePick ist im View ein berechneter
	 *      case-Ausdruck mit @Semantics.booleanIndicator - ob SADL daraus
	 *      Edm.Boolean oder Edm.String macht, und ob so ein Feld ueberhaupt
	 *      filterbar ist, muss damit niemand mehr wissen.
	 *   2. INDIZIERBAR. WarehouseNumber ist das fuehrende Schluesselfeld von
	 *      LTAP. Ohne diese Einschraenkung lief die Abfrage ueber die ganze
	 *      Tabelle, verbunden mit LTAK, mit einem ODER ueber zwei berechnete
	 *      Ausdruecke - auf einem produktiven System ein Kandidat fuer einen
	 *      Abbruch.
	 *   3. Gleiche Semantik: die Kennzeichen SIND genau vltyp = 'AS' bzw.
	 *      nltyp = 'AS'.
	 *
	 * ℹ Die zurueckgelieferten Kennzeichen werden weiter verwendet - fuer die
	 * AUSWERTUNG in shadowedPicks( ) ueber isFlagged( ), das 'X' und true
	 * gleichermassen behandelt. Als Daten sind sie unproblematisch; nur im
	 * FILTER waren sie es nicht.
	 */
	try {
		const aRows = await fetchRows(
			oModel,
			`WarehouseNumber eq ${literal(LGNUM)}`
				+ ` and (SourceStorageType eq ${literal(AS_TYPE)}`
				+ ` or DestStorageType eq ${literal(AS_TYPE)})`
				+ ` and CreationDate ge ${sFromDate}`,
			MAX_AS
		);
		return { rows: aRows, truncated: aRows.length >= MAX_AS, ok: true };
	} catch (oError) {
		/*
		 * ⚠ NICHT STILL SCHLUCKEN. Der Leerzustand verweist auf die Konsole -
		 * dann muss dort auch etwas stehen. Beim ersten Anlauf tat es das
		 * nicht, und der Grund des Fehlschlags war deshalb nicht auffindbar.
		 */
		// eslint-disable-next-line no-console
		console.error("[WA-Pruefung] Lesen der TA-Positionen fehlgeschlagen:", oError);
		return { rows: [], truncated: false, ok: false };
	}
}

/**
 * Findet die TAs, deren Pick-Auftrag nicht ausgeloest werden KANN.
 *
 * 🔴 DIE SIGNATUR DES ZXLTOU01-FEHLERS, und sie steht in den SAP-Daten
 * selbst - kein Log noetig, keine Heuristik:
 *
 *   ZXLTOU01 verzweigt mit "elseif". Sobald EINE Position des TA
 *   NLTYP = 'AS' traegt, feuert nur der Einlagerungs-Trigger; der Pick-Zweig
 *   wird nie erreicht. Es gibt dann keinen POST und - weil der Outbound-Pfad
 *   Erfolge ohnehin nicht protokolliert - auch keinen Logeintrag. Genau
 *   deshalb blieben am 18.08.2026 zwoelf von dreissig Pick-TAs zwei Wochen
 *   lang unbemerkt.
 *
 * Betroffen ist also jede TA mit MINDESTENS EINER AS-Einlagerungsposition
 * UND mindestens einer AS-Auslagerungsposition.
 *
 * ⚠ Bleibt der Befund auch nach einem Fix gueltig? Ja, nur mit anderer
 * Bedeutung: waere der "elseif" in zwei "if" geaendert, griffen bei diesen
 * TAs BEIDE Trigger, und HiLIS bekaeme Pick UND Einlagerung. Ob das fachlich
 * gewollt ist, ist die zweite offene Frage an derselben Stelle. Die Liste
 * zeigt in beiden Faellen dieselbe Menge - sie ist die Beobachtungsliste zu
 * diesem Punkt.
 */
export function shadowedPicks(aRows: TaPos[]): ShadowedPick[] {
	const mByOrder = new Map<string, TaPos[]>();
	aRows.forEach((oRow) => {
		const sOrder = text(oRow.TransferOrder).trim();
		if (!sOrder) {
			return;
		}
		const aGroup = mByOrder.get(sOrder);
		if (aGroup) {
			aGroup.push(oRow);
		} else {
			mByOrder.set(sOrder, [oRow]);
		}
	});

	const aResult: ShadowedPick[] = [];
	mByOrder.forEach((aItems, sOrder) => {
		const aPick = aItems.filter((o) => isFlagged(o.IsAutoStorePick));
		const aPut = aItems.filter((o) => isFlagged(o.IsAutoStorePutAway));

		// Beides muss vorkommen - sonst ist die TA reine Ein- oder reine
		// Auslagerung und der Trigger greift richtig.
		if (!aPick.length || !aPut.length) {
			return;
		}

		aResult.push({
			TransferOrder: sOrder,
			CreationDate: text(aItems[0].CreationDate),
			PickItems: aPick.length,
			PutAwayItems: aPut.length,
			Materials: Array.from(new Set(aPick.map((o) => text(o.Material).replace(/^0+/, ""))))
				.filter((s) => s).join(", "),
			// Dieselbe Position ist Quelle UND Ziel im AutoStore - der
			// Sonderfall, der fachlich nie bestaetigt wurde.
			HasBoth: aItems.some((o) => isFlagged(o.IsAutoStorePick) && isFlagged(o.IsAutoStorePutAway))
		});
	});

	// Neueste zuerst, wie ueberall in dieser App.
	aResult.sort((a, b) => (b.CreationDate ?? "").localeCompare(a.CreationDate ?? ""));
	return aResult;
}
