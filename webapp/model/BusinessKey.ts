/**
 * Zerlegung des BUSINESS_KEY - die Frontend-Entsprechung zu
 * ZCL_ZLE_AUST_TO_UTIL=>split_put_order_number / split_pick_order_number.
 *
 * Bildungsregel aus Michaels Einarbeitungsdoku (Stand 27.08.2026):
 *
 *   KEY_TYPE   Aufbau                        Laenge
 *   PUT        TANUM(10) + TAPOS(4) + LGNUM(3)   17
 *   PICK       TANUM(10) + LGNUM(3)              13
 *   MATNR      Materialnummer mit ALPHA = OUT     -
 *   ADVICE     Advice-Nummer                      -
 *
 * ⚠ ES STEHEN KEINE TRENNZEICHEN IM SCHLUESSEL. Die Schreibweise
 * "TANUM-TAPOS-LGNUM" in der ABAP Doc ist nur Notation - beide build_*-
 * Methoden bauen per String-Template und CONDENSE ... NO-GAPS.
 *
 * 🔴 DIE PRUEFUNGEN FOLGEN DEM ABAP-GEGENSTUECK, in derselben Reihenfolge:
 *   1. Leerraum entfernen, dann EXAKTE Laengenpruefung (17 bzw. 13) - bei
 *      Abweichung sofort raus, alle Felder leer, ok = false
 *   2. Ziffernpruefung auf die ersten 14 (PUT) bzw. 10 Stellen (PICK)
 *   3. erst dann zerlegen
 *
 * ⚠ AUCH DAS CONDENSE IST NACHGEBAUT, nicht nur ein trim( ) - siehe die
 * Funktion condense( ) unten. Fuer realistische Werte macht das keinen
 * Unterschied; der Grund ist der Abgleich mit der ABAP-Fassung, nicht die
 * Fachlichkeit.
 *
 * Und daraus folgt die Zusicherung, die die Doku ausdruecklich gibt: weil 17
 * und 13 exakt geprueft werden, sind die beiden Formate NICHT verwechselbar.
 * Ein 13-stelliger Wert kann kein PutAway sein und umgekehrt.
 *
 * ⚠ `ok` IMMER auswerten. Bei ok = false sind tanum/tapos/lgnum leer und
 * nicht "vielleicht doch brauchbar" - genau wie beim ABAP-Gegenstueck.
 */

/*
 * Konstanten eines ES-Moduls, keine globalen Bezeichner - gleiche Ausnahme
 * wie in model/ProcessAxis.ts und model/formatter.ts.
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
const LEN_TANUM = 10;
const LEN_TAPOS = 4;
const LEN_LGNUM = 3;
/** PUT: TANUM + TAPOS + LGNUM. */
const LEN_PUT = LEN_TANUM + LEN_TAPOS + LEN_LGNUM;
/** PICK: TANUM + LGNUM. */
const LEN_PICK = LEN_TANUM + LEN_LGNUM;
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

export interface KeyParts {
	/** false = nicht zerlegbar. Dann sind ALLE anderen Felder leer. */
	ok: boolean;
	tanum: string;
	/** Nur bei PUT gefuellt - eine PickOrder umfasst die ganze TA. */
	tapos: string;
	lgnum: string;
	/** Nur bei MATNR gefuellt. */
	material: string;
}

/* eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable -- Modul-Scope, s. oben */
const EMPTY: KeyParts = { ok: false, tanum: "", tapos: "", lgnum: "", material: "" };

/**
 * Das Gegenstueck zu ABAPs CONDENSE: fuehrenden und folgenden Leerraum
 * entfernen UND mehrfache innere Leerzeichen auf eines zusammenziehen.
 *
 * `trim( )` allein taete es fuer jeden realistischen Wert - ein BUSINESS_KEY
 * besteht aus Ziffern, und die CHAR50-Auffuellung sind Randleerzeichen. Hier
 * steht trotzdem die vollstaendige Entsprechung, und der Grund ist NICHT
 * fachlich, sondern der Abgleich: dieselbe Regel wird an zwei Stellen
 * implementiert, in ABAP und hier. Zwei Fassungen, die sich in einem Randfall
 * unterscheiden, muss beim naechsten Anfassen jemand erst wieder gegenpruefen -
 * und das kostet mehr, als der Randfall je einbringt.
 *
 * Der abweichende Fall waere gewesen: "00060244110001  01" (zwei innere
 * Leerzeichen, 18 Zeichen) wird durch CONDENSE 17 Zeichen lang und damit
 * zerlegbar, mit lgnum = " 01". Ein solcher Schluessel ist kaputt; ihn strenger
 * abzuweisen waere vertretbar gewesen, aber nicht wichtig genug, um von der
 * Referenz abzuweichen.
 */
function condense(sValue: string): string {
	return sValue.trim().replace(/\s+/g, " ");
}

function digitsOnly(sValue: string): boolean {
	return /^\d+$/.test(sValue);
}

/**
 * Zerlegt den Schluessel gemaess KEY_TYPE.
 *
 * Der Typ wird mitgegeben, nicht geraten - er ist genau dafuer da ("sagt, mit
 * welcher split_*-Methode der BUSINESS_KEY zerlegbar ist"). Fehlt er, wird
 * ueber die Laenge entschieden; das ist zulaessig, weil 17 und 13 eindeutig
 * sind, aber der Typ ist der bessere Weg.
 */
export function split(sKey?: string | null, sKeyType?: string | null): KeyParts {
	const sValue = condense(sKey ?? "");
	const sType = (sKeyType ?? "").trim().toUpperCase();
	if (!sValue) {
		return EMPTY;
	}

	if (sType === "MATNR") {
		return { ok: true, tanum: "", tapos: "", lgnum: "", material: sValue };
	}

	const bPut = sType === "PUT" || (!sType && sValue.length === LEN_PUT);
	const bPick = sType === "PICK" || (!sType && sValue.length === LEN_PICK);

	if (bPut && sValue.length === LEN_PUT && digitsOnly(sValue.slice(0, LEN_TANUM + LEN_TAPOS))) {
		return {
			ok: true,
			tanum: sValue.slice(0, LEN_TANUM),
			tapos: sValue.slice(LEN_TANUM, LEN_TANUM + LEN_TAPOS),
			lgnum: sValue.slice(LEN_TANUM + LEN_TAPOS),
			material: ""
		};
	}

	if (bPick && sValue.length === LEN_PICK && digitsOnly(sValue.slice(0, LEN_TANUM))) {
		return {
			ok: true,
			tanum: sValue.slice(0, LEN_TANUM),
			tapos: "",
			lgnum: sValue.slice(LEN_TANUM),
			material: ""
		};
	}

	return EMPTY;
}

/**
 * Die Positionsnummer aus dem Schluessel - ohne fuehrende Nullen.
 *
 * 💡 WOFUER: bei KEY_TYPE = PUT steckt die TAPOS IM SCHLUESSEL. Wo der
 * Aufrufer `iv_order_line` nicht mitgibt (Michaels offener Punkt P17), laesst
 * sie sich also trotzdem zeigen - abgeleitet, nicht geraten.
 *
 * Bei PICK gibt es keine: eine PickOrder umfasst die ganze TA, der Schluessel
 * traegt bewusst keine Position.
 */
export function positionFrom(sKey?: string | null, sKeyType?: string | null): string {
	const oParts = split(sKey, sKeyType);
	if (!oParts.ok || !oParts.tapos) {
		return "";
	}
	return oParts.tapos.replace(/^0+/, "") || "0";
}
