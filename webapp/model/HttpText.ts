/**
 * Macht HTTP-Fehlertexte aus dem Log lesbar.
 *
 * HiLIS antwortet bei einem Serverfehler (HTTP 500) nicht mit JSON, sondern
 * mit einer kompletten HTML-Fehlerseite. Die landet unveraendert in MESSAGE
 * und JSON_PAYLOAD und war im Dialog nur als Quelltext zu sehen
 * (Rueckmeldung Gollmer, 02.10.2026).
 *
 * ⚠ Bewusst KEIN Rendern: das HTML kommt aus einem Fremdsystem, als HTML
 * eingebunden waere es eine XSS-Luecke. DOMParser erzeugt ein inertes
 * Dokument - keine Skriptausfuehrung, kein Nachladen von CSS/Bildern -, und
 * herausgegeben wird nur dessen Text. Angezeigt wird das weiter in Text/
 * TextArea, also ebenfalls als reiner Text.
 */

function collectText(oNode: Node, aOut: string[]): void {
	const sDrop = " SCRIPT STYLE NOSCRIPT TEMPLATE LINK META HEAD ";
	const sBlock = " P DIV SECTION ARTICLE HEADER FOOTER MAIN NAV ASIDE H1 H2 H3 H4 H5 H6"
		+ " LI DT DD TR PRE BLOCKQUOTE TABLE UL OL DL FORM FIELDSET HR ";
	if (oNode.nodeType === Node.TEXT_NODE) {
		aOut.push(oNode.textContent ?? "");
		return;
	}
	if (oNode.nodeType !== Node.ELEMENT_NODE) {
		return;
	}
	const sTag = ` ${(oNode as Element).tagName.toUpperCase()} `;
	if (sDrop.includes(sTag)) {
		return;
	}
	if (sTag === " BR ") {
		aOut.push("\n");
		return;
	}
	const bBlock = sBlock.includes(sTag);
	if (bBlock) {
		aOut.push("\n");
	}
	oNode.childNodes.forEach((oChild) => collectText(oChild, aOut));
	if (bBlock) {
		aOut.push("\n");
	}
}

function htmlToText(sHtml: string): string {
	const oDoc = new DOMParser().parseFromString(sHtml, "text/html");
	const sTitle = (oDoc.title ?? "").trim();
	const aParts: string[] = [];
	if (oDoc.body) {
		collectText(oDoc.body, aParts);
	}

	const aLines: string[] = [];
	for (const sLine of aParts.join("").split("\n")) {
		const sClean = sLine.replace(/\s+/g, " ").trim();
		if (sClean && sClean !== aLines[aLines.length - 1]) {
			aLines.push(sClean);
		}
	}
	if (sTitle && aLines[0] !== sTitle) {
		aLines.unshift(sTitle);
	}
	return aLines.join("\n");
}

/** Zeilen, die fuer sich gueltiges JSON sind, eingerueckt ausgeben. */
function prettyJsonLines(sText: string): string {
	return sText.split("\n").map((sLine) => {
		const sTrim = sLine.trim();
		if (!/^[{[]/.test(sTrim)) {
			return sLine;
		}
		try {
			return JSON.stringify(JSON.parse(sTrim), null, 2);
		} catch {
			return sLine;
		}
	}).join("\n");
}

/**
 * Text bis zum Beginn des HTML unveraendert (JSON darin eingerueckt), das
 * HTML selbst als Klartext. Ohne HTML kommt der Text unveraendert zurueck.
 */
export function readableHttpText(sText: string): string {
	const sRaw = sText ?? "";
	const iStart = sRaw.search(/<!DOCTYPE\s+html|<html[\s>]/i);
	if (iStart < 0) {
		return sRaw;
	}
	const sPrefix = prettyJsonLines(sRaw.slice(0, iStart)).trimEnd();
	const sBody = htmlToText(sRaw.slice(iStart));
	return sPrefix ? `${sPrefix}\n${sBody}` : sBody;
}
