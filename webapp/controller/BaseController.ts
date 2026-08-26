import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import * as formatter from "../model/formatter";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default abstract class BaseController extends Controller {

	/**
	 * Fuer Formatter-Bindings in der View: formatter: '.formatter.criticalityState'
	 */
	public formatter = formatter;

	/**
	 * Steuermodell der Oberflaeche (lastRefreshText, selectedProcess, kpi).
	 */
	protected getUiModel(): JSONModel {
		return this.getOwnerComponent()?.getModel("ui") as JSONModel;
	}

	/**
	 * Benannte OData-V4-Modelle: "mainModel" (AppLog) und "tpaModel" (Tpa).
	 */
	protected getODataModel(sName: string): ODataModel {
		return this.getOwnerComponent()?.getModel(sName) as ODataModel;
	}
}
