/**
 * Abbildung der CDS-Kritikalitaet auf Fiori-Semantik.
 *
 * Die Werte stammen aus den berechneten Feldern LogTypeCriticality
 * (ZLE_AUST_C_APPL_LOG: E=1, W=2, S=3) und StatusCriticality
 * (ZLE_AUST_C_TPA) und folgen dem SAP-Standard: 1 = negativ,
 * 2 = kritisch, 3 = positiv, 0 = neutral.
 *
 * Farbe wird immer zusammen mit einem Icon ausgegeben - semantische
 * Farbe allein verletzt das Zwei-Sinne-Prinzip der Fiori-Guidelines.
 */

export function criticalityState(iCriticality: number): string {
	switch (iCriticality) {
		case 1: return "Error";
		case 2: return "Warning";
		case 3: return "Success";
		default: return "None";
	}
}

export function criticalityIcon(iCriticality: number): string {
	switch (iCriticality) {
		case 1: return "sap-icon://error";
		case 2: return "sap-icon://alert";
		case 3: return "sap-icon://sys-enter-2";
		default: return "sap-icon://information";
	}
}
