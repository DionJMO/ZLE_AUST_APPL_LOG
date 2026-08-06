import UIComponent from "sap/ui/core/UIComponent";
import JSONModel from "sap/ui/model/json/JSONModel";
import Device from "sap/ui/Device";

/**
 * @namespace zui5_zle_aust_mon
 */
export default class Component extends UIComponent {

	public static metadata = {
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"]
	};

	public init(): void {
		super.init();

		this.setModel(new JSONModel(Device), "device");

		// Steuermodell der Oberflaeche.
		// showInOutSplit bleibt false, solange das Backend WE und WA nicht
		// unterscheidbar protokolliert (siehe CLAUDE.md, O-27).
		this.setModel(new JSONModel({
			lastRefreshText: "",
			showInOutSplit: false
		}), "ui");

		this.getRouter().initialize();
	}
}
