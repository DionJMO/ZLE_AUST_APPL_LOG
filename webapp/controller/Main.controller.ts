import DateFormat from "sap/ui/core/format/DateFormat";
import BaseController from "./BaseController";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default class Main extends BaseController {

	public onInit(): void {
		this._stampRefresh();
	}

	public onRefresh(): void {
		this._stampRefresh();
	}

	/**
	 * Schreibt den aktuellen Zeitpunkt in das ui-Modell. Bewusst hier und nicht
	 * als Expression Binding in der View: dort waere der Wert nicht reaktiv
	 * und nicht testbar.
	 */
	private _stampRefresh(): void {
		const oFormat = DateFormat.getDateTimeInstance({ style: "medium" });
		this.getUiModel().setProperty("/lastRefreshText", oFormat.format(new Date()));
	}
}
