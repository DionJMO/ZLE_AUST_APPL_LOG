sap.ui.define(["sap/ovp/cards/generic/Component"], function (CardComponent) {
	"use strict";

	return CardComponent.extend("zui5_zle_aust_mon.ext.kpi.Component", {
		metadata: {
			properties: {
				contentFragment: {
					type: "string",
					defaultValue: "zui5_zle_aust_mon.ext.kpi.Kpi"
				}
			},
			customizing: {
				"sap.ui.controllerExtensions": {
					"sap.ovp.cards.generic.Card": {
						controllerName: "zui5_zle_aust_mon.ext.kpi.Kpi"
					}
				}
			},
			version: "1.0.0"
		}
	});
});
