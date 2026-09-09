import ResourceBundle from "sap/base/i18n/ResourceBundle";

/**
 * Uebersetzt die technischen Meldungstexte des Backends in sprechendes
 * Deutsch — Punkt 6 der Rueckmeldung Gollmer/Tolksdorf.
 *
 * AUFTEILUNG: MUSTER HIER, WORTLAUT IN i18n
 * Die Regel besteht aus zwei Teilen, und nur einer davon ist Text. Das
 * MUSTER ist Code und steht hier. Der WORTLAUT steht in i18n und ist
 * damit die Datei, die Fachbereich und Kollegen selbst lesen und
 * korrigieren koennen, ohne Code anzufassen. Dieselbe Aufteilung wie bei
 * ProcessAxis und KpiLoader: Definition im Modul, Beschriftung im Bundle.
 *
 * ERSTE PASSENDE REGEL GEWINNT — die Liste ist deshalb von SPEZIELL nach
 * ALLGEMEIN geordnet. Wer eine Regel ergaenzt, setzt sie VOR die
 * allgemeineren, sonst schluckt msgHttp sie.
 *
 * KEIN TREFFER HEISST: ORIGINALTEXT.
 * Nie ein Sammelbegriff, nie eine Notlösung. Eine unbekannte Meldung
 * unverfaelscht zu zeigen ist immer besser, als sie falsch zu benennen.
 * Der Originaltext bleibt zusaetzlich im Tooltip der Zelle stehen.
 *
 * LOKALISIERUNG: die Abdeckung dieser Tabelle IST die Abdeckung der
 * Lokalisierung. Jede getroffene Meldung wird durch unseren Text ersetzt
 * und ist damit uebersetzbar; jede nicht getroffene bleibt Backend-Text
 * (teils deutsch aus ABAP, teils englisch von HiLIS) und ist es nicht.
 *
 * WARUM EIN CACHE UND KEIN BUNDLE-PARAMETER
 * Ein XML-Formatter bekommt das ResourceBundle nicht uebergeben. Deshalb
 * wird der Wortlaut einmal in onInit ueber init( ) aufgeloest und hier
 * gehalten; translate( ) ist danach eine reine Funktion und aus jedem
 * Formatter aufrufbar. Laeuft init( ) nicht, liefert translate( ) leer
 * und der Aufrufer faellt auf den Originaltext zurueck - kein Absturz.
 */

interface Rule {
	/** i18n-Schluessel des sprechenden Textes */
	key: string;
	/** Untergruppen des Musters werden zu {0}, {1}, ... */
	pattern: RegExp;
}

// Regeln und Cache sind Modulzustand, keine globalen Bezeichner. Die Regel
// sap-no-global-variable behandelt Modul-Scope faelschlich als global.
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const RULES: Rule[] = [
	// --- WM-Trigger, fachliche Abbrueche (Typ W) --------------------------
	{ key: "msgNoMasterData",
	  pattern: /^Pos (\d+) Material (\d+): HiLIS-Stammdaten nicht lesbar/ },
	{ key: "msgUomMismatch",
	  pattern: /^Pos (\d+) Material (\d+): ME-Abweichung SAP '([^']*)' <> HiLIS '([^']*)'/ },

	// --- WM-Trigger, technische Fehlschlaege (Typ E) ----------------------
	{ key: "msgPutAwayFailed",
	  pattern: /^HiLIS PutAway TA (\S+) Pos (\d+) LGNUM (\S+) fehlgeschlagen: (.+)$/ },
	{ key: "msgConnectFailed",
	  pattern: /^HiLIS \w+ TA (\S+) LGNUM (\S+) Verbindungsfehler: (.+)$/ },
	{ key: "msgStornoFailed",
	  pattern: /^HiLIS Storno Order (\S+) fehlgeschlagen: (.+)$/ },
	// Statuspruefung VOR dem Storno: ist der Auftrag in HiLIS schon
	// abgeschlossen, unterbleibt es. Fachlich der Normalfall, nicht ein
	// Fehlschlag - siehe E/W/S-Regel, Punkt 5 der Rueckmeldung.
	{ key: "msgCancelStopped",
	  pattern: /^Storno abgebrochen - HiLIS-Status (\S+) nicht/ },
	/*
	 * ⚠ Der Wortlaut nennt die Auftragsnummer NICHT mehr, obwohl das Muster
	 * sie faengt: sie steht in der Spalte TPA-Nummer daneben, und 17 Ziffern
	 * am Anfang schoben den eigentlichen Grund aus dem sichtbaren Bereich.
	 * Dieselbe Regel wie bei messageShort, das "Pos NNNN" und
	 * "Material <18-stellig>" aus demselben Grund entfernt.
	 *
	 * Gruppe 1 bleibt im Muster, damit der Zusammenhang lesbar bleibt und
	 * der Wortlaut sie bei Bedarf wieder aufnehmen kann.
	 */
	{ key: "msgConfirmFailed",
	  pattern: /^HiLIS Quittierung Order (\S+) fehlgeschlagen: (.+)$/ },

	// --- Monitoring-Wiederanstoss ----------------------------------------
	{ key: "msgResendNoLines",
	  pattern: /^Resend TA (\S+): keine offenen AS-Positionen$/ },
	{ key: "msgCancelNoLines",
	  pattern: /^Cancel TA (\S+): keine quittierten AS-Positionen$/ },

	// --- Quittierung durch HiLIS (Provider-Seite) ------------------------
	{ key: "msgTpaConfirmed",
	  pattern: /^TPA quittiert (\S+)/ },
	{ key: "msgTpaError",
	  pattern: /^TPA-Fehler (\S+?)-(\d+):\s*(.*)$/ },

	// --- Consumer-Schicht, englische Festtexte ---------------------------
	{ key: "msgIbCreateOk",  pattern: /^POST create inbound order OK$/ },
	{ key: "msgIbCancelOk",  pattern: /^DELETE cancel inbound order OK$/ },
	{ key: "msgIbUpdateOk",  pattern: /^PUT update inbound order OK$/ },
	{ key: "msgIbAddLineOk", pattern: /^POST add inbound order line OK$/ },
	{ key: "msgStatusFailed", pattern: /^GET order status failed$/ },

	// --- allgemeinster Fall, muss ZULETZT stehen --------------------------
	{ key: "msgHttp",
	  pattern: /^HTTP (\d{3}) ([A-Z]+) (\S+?):\s*(.+)$/ }
];

/**
 * INNENTEXTE - die durchgereichten Fremdtexte in den Platzhaltern.
 *
 * Die Regeln oben ersetzen den RAHMEN eines Satzes. Was in {1} landet, ist
 * aber Text von jemand anderem: entweder aus cx_rest_client_exception
 * (deutsch, aus ABAP) oder von HiLIS (englisch). Ergebnis vor dieser
 * Ergaenzung war ein Mischsatz:
 *
 *   "Confirming order 00060244210001001 failed:
 *    HTTP-Client - Kommunikationsfehler"
 *
 * Diese Liste uebersetzt solche Fremdtexte, bevor sie in den Platzhalter
 * gehen. Sie wirkt in BEIDE Richtungen: im deutschen Bundle wird auch
 * HiLIS' englischer Text deutsch, was die deutsche Seite ebenfalls
 * verbessert.
 *
 * ⚠ VOLLTREFFER, nicht Teiltreffer. Ein Fremdtext ist eine ganze Meldung;
 * ein Teilmuster wuerde irgendwann einen Satz zerschneiden, in dem die
 * Phrase nur vorkommt.
 *
 * ⚠ Fremdtexte MIT variablem Anteil ("Batch handling is not active for
 * item '11139'") stehen hier absichtlich NICHT: sie brauchten Platzhalter
 * in Platzhaltern. Sie bleiben unveraendert - lesbar, nur nicht uebersetzt.
 *
 * Kein Treffer heisst: Fremdtext unveraendert. Diese Liste kann also nur
 * verbessern, nie etwas kaputt machen.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const INNER: Rule[] = [
	{ key: "innerCommError", pattern: /^HTTP-Client\s*-\s*Kommunikationsfehler\.?$/ },
	{ key: "innerOrderNotFound", pattern: /^The requested Order has not been found\.?$/ },
	{ key: "innerItemNotFound", pattern: /^Requested Item couldn'?t be found\.?$/ }
];

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const mTexts = new Map<string, string>();

/** Wortlaut einmal aus dem Bundle holen. Aufruf in Main.onInit. */
export function init(oBundle?: ResourceBundle): void {
	mTexts.clear();
	if (!oBundle) {
		return;
	}
	[...RULES, ...INNER].forEach((oRule) => {
		const sText = oBundle.getText(oRule.key);
		// getText liefert bei fehlendem Schluessel den Schluessel selbst
		// zurueck - so ein Treffer waere schlimmer als keiner.
		if (sText && sText !== oRule.key) {
			mTexts.set(oRule.key, sText);
		}
	});
}

/**
 * Uebersetzt einen durchgereichten Fremdtext, wenn eine Innenregel voll
 * zutrifft. Sonst bleibt er unveraendert.
 */
function innerText(sRaw: string): string {
	const sTrimmed = sRaw.trim();
	for (const oRule of INNER) {
		if (oRule.pattern.test(sTrimmed)) {
			return mTexts.get(oRule.key) ?? sRaw;
		}
	}
	return sRaw;
}

/**
 * Liefert den sprechenden Text oder einen leeren String, wenn keine Regel
 * passt. Der Aufrufer entscheidet dann, was er stattdessen zeigt.
 */
export function translate(sMessage?: string | null): string {
	if (!sMessage || mTexts.size === 0) {
		return "";
	}
	for (const oRule of RULES) {
		const aMatch = oRule.pattern.exec(sMessage);
		if (!aMatch) {
			continue;
		}
		const sPattern = mTexts.get(oRule.key);
		if (!sPattern) {
			return "";
		}
		return sPattern.replace(/\{(\d)\}/g, (sWhole, sIndex: string) => {
			const sGroup = aMatch[Number(sIndex) + 1];
			return sGroup === undefined ? sWhole : innerText(sGroup);
		});
	}
	return "";
}
