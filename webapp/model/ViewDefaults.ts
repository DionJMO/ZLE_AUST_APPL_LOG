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

/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */

/**
 * Erledigte Vorgaenge von vornherein ausblenden (Festlegung Maring,
 * 01.09.2026). Wer die Seite oeffnet, sucht das Offene; was sich durch einen
 * Wiederanstoss im Hintergrund von selbst erledigt hat, ist Historie.
 */
export const OPEN_ONLY_DEFAULT = true;

/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */
