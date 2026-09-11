import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

/**
 * Die Typachse der Meldungen - E, W, S und ihre Buendel.
 *
 * EINZIGE QUELLE fuer die Zuordnung "Schluessel -> LogType-Werte". Vorher
 * stand der Typfilter als nacktes EQ in _msgFilters( ) und als Literalliste
 * im XML; mit der Buendelung von E und W waeren daraus zwei Stellen mit
 * derselben Regel geworden - genau die Redundanz, die ProcessAxis fuer die
 * Prozessachse schon beseitigt hat.
 *
 * 🔴 WARUM E UND W ZUSAMMEN UNTER EINEN KNOPF (Festlegung Tolksdorf,
 * 11.09.2026)
 * Die Unterscheidung ist fachlich richtig und fuer die Bedienung falsch:
 *
 *   E  technischer Fehlschlag - HTTP, Verbindung, Berechtigung
 *   W  fachlicher Abbruch - Stammdaten, ME-Abweichung, Menge 0
 *
 * Wer nachsieht, "wo klemmt es", will beides. Wer nur E waehlte, uebersah
 * die Mehrheit der Abbrueche (fuenf von sechs Abbruchstellen loggen W) -
 * derselbe Denkfehler, an dem die alte OVP-Kachel scheiterte (O-25).
 *
 * ⚠ GEBUENDELT WIRD NUR DIE AUSWAHL, NICHT DIE ANZEIGE. Die Zeilen behalten
 * Symbol und Farbe je Typ (logTypeIcon / logTypeState an der Typ-Spalte) -
 * ausdrueckliche Vorgabe: "separate Zeilen bei denen die alten Icons
 * beibehalten werden an denen man noch unterscheiden kann". Die Buendelung
 * ist ein Filter, keine Gleichsetzung.
 */

/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
/** Alles zeigen. */
export const KEY_ALL = "";
/** Fehler und Abbrueche zusammen - der Knopf, den der Anwender bedient. */
export const KEY_PROBLEM = "EW";

/**
 * Schluessel -> LogType-Werte. Ein Schluessel ohne Eintrag ist ein einzelner
 * LogType und wird als solcher behandelt - so bleiben die alten Links mit
 * ?t=E und ?t=W gueltig, ohne dass sie hier aufgezaehlt werden muessten.
 */
const GROUPS: Record<string, string[]> = {
	[KEY_PROBLEM]: ["E", "W"]
};
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

/** Die LogType-Werte hinter einem Schluessel. Leer heisst: kein Typfilter. */
export function expand(sKey?: string | null): string[] {
	const sRaw = (sKey ?? "").trim().toUpperCase();
	if (!sRaw) {
		return [];
	}
	return GROUPS[sRaw] ?? [sRaw];
}

/**
 * Filter fuer einen Typschluessel - ein EQ, oder ein ODER ueber mehrere.
 *
 * ⚠ Bewusst EQ und kein IN: der V4-Filter uebersetzt ein ODER aus EQ in
 * genau das, was der Service versteht, und die App baut ihre Filter sonst
 * ueberall so (s. ProcessAxis.processFilter).
 */
export function filter(sKey?: string | null): Filter | undefined {
	const aValues = expand(sKey);
	if (!aValues.length) {
		return undefined;
	}
	const aParts = aValues.map((s) => new Filter({
		path: "LogType", operator: FilterOperator.EQ, value1: s
	}));
	return aParts.length === 1 ? aParts[0] : new Filter({ filters: aParts, and: false });
}

/**
 * Der Schluessel, unter dem ein Wert im Segmentknopf GEDRUECKT erscheint.
 *
 * E und W fallen beide auf das Buendel zurueck. Damit bleibt der Knopf
 * "Fehler" auch dann gedrueckt, wenn ueber den Spaltentrichter auf einen
 * der beiden Typen verfeinert wurde - sonst saehe die Leiste so aus, als
 * waere gar kein Typfilter gesetzt.
 */
export function groupKey(sKey?: string | null): string {
	const sRaw = (sKey ?? "").trim().toUpperCase();
	if (!sRaw) {
		return KEY_ALL;
	}
	const sFound = Object.keys(GROUPS).find((sGroup) => GROUPS[sGroup].includes(sRaw));
	return sFound ?? sRaw;
}

/**
 * Beschriftung eines Typschluessels - fuer Filter-Chips und Tooltips.
 *
 * Wortlaut aus i18n, Zuordnung hier: dieselbe Aufteilung wie in
 * ProcessAxis und MessageText.
 */
export function label(sKey: string, oBundle: ResourceBundle): string {
	const sRaw = (sKey ?? "").trim().toUpperCase();
	if (!sRaw) {
		return oBundle.getText("typeAll") ?? "";
	}
	/*
	 * ueber type*, nicht ueber logType*: das sind zwei Vokabulare mit
	 * verschiedenen Aufgaben. logTypeE ("Fehler") beschriftet den ZUSTAND
	 * einer Zeile, typeE ("Fehler (technisch)") die AUSWAHL - und dort
	 * braucht es den Zusatz, weil E und W nebeneinander zur Wahl stehen.
	 */
	return oBundle.getText(sRaw === KEY_PROBLEM ? "typeProblem" : `type${sRaw}`) ?? sRaw;
}
