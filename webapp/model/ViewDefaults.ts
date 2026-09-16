/**
 * Startzustand der Meldungssicht.
 *
 * WARUM EIN EIGENES MODUL
 * Jeder dieser Werte wird an ZWEI Stellen gebraucht: als Startwert des
 * ui-Modells in Component.ts und in _syncUrl( ), das den Standard aus der
 * Adresse heraushaelt. Zwei Kopien wuerden auseinanderlaufen, und dann traege
 * jede URL einen Parameter, der nichts aussagt - oder schlimmer, ein
 * Ausschalten waere nicht speicherbar.
 *
 * Dieselbe Lehre wie bei ProcessAxis.KEY_DEFAULT, nur ohne fachliches
 * Zuhause: "gruppiert" gehoert zur Verdichtung, "nur offene" zum
 * Erledigt-Zustand - ein gemeinsames Modul fuer den Startzustand ist
 * ehrlicher, als sie in zwei themenfremde Module zu haengen.
 *
 * ⚠ Wer einen Wert umstellt, muss nichts weiter anfassen: _syncUrl( )
 * schreibt grundsaetzlich nur die ABWEICHUNG vom Standard, in beide
 * Richtungen.
 */

import * as LogTypeAxis from "./LogTypeAxis";

/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */

/**
 * Erledigte Vorgaenge von vornherein ausblenden (Festlegung Maring,
 * 01.09.2026). Wer die Seite oeffnet, sucht das Offene; was sich durch einen
 * Wiederanstoss im Hintergrund von selbst erledigt hat, ist Historie.
 */
export const OPEN_ONLY_DEFAULT = true;

/**
 * Typfilter beim Start: Fehler und Abbrueche (Festlegung Maring,
 * 15.09.2026). Wer die Seite oeffnet, sucht das Auffaellige - die
 * Erfolgsmeldungen sind die grosse Mehrheit und verdecken es.
 */
export const TYPE_DEFAULT = LogTypeAxis.KEY_PROBLEM;

/**
 * Tagesfilter beim Start: heute (Festlegung Maring, 15.09.2026).
 *
 * 🔴 ALS FUNKTION UND NICHT ALS KONSTANTE. Der Wert aendert sich taeglich;
 * eine Konstante waere beim Laden des Moduls eingefroren und zeigte in einer
 * ueber Nacht offen gebliebenen Sitzung den Vortag.
 *
 * ⚠ ORTSZEIT, nicht UTC - "heute" ist, was der Anwender darunter versteht.
 * CreatedAt leitet der CDS-View dagegen aus einem UTC-Zeitstempel ab. In der
 * Stunde nach Mitternacht (CEST: bis 02:00) liegt der Tag deshalb bis zu zwei
 * Stunden auseinander; Saetze aus diesem Fenster tragen noch den Vortag. Das
 * ist bewusst in Kauf genommen: die Alternative waere ein Filter, der dem
 * Anwender morgens den falschen Tag anzeigt.
 *
 * ⚠ toISOString( ) waere hier FALSCH - das rechnet nach UTC um und kippt
 * genau in diesem Fenster auf den Vortag. Deshalb von Hand aus den lokalen
 * Bestandteilen gebaut.
 */
export function today(): string {
	const oNow = new Date();
	const sMonth = String(oNow.getMonth() + 1).padStart(2, "0");
	const sDay = String(oNow.getDate()).padStart(2, "0");
	return `${oNow.getFullYear()}-${sMonth}-${sDay}`;
}

/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */
