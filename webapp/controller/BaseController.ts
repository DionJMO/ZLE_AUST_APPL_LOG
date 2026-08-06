import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default abstract class BaseController extends Controller {

	/**
	 * Steuermodell der Oberflaeche (lastRefreshText, showInOutSplit).
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
