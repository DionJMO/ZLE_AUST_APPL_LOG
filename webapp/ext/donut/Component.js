sap.ui.define(["sap/ovp/cards/generic/Component"], function (CardComponent) {
	"use strict";

	return CardComponent.extend("zui5_zle_aust_mon.ext.donut.Component", {
		metadata: {
			properties: {
				contentFragment: {
					type: "string",
					defaultValue: "zui5_zle_aust_mon.ext.donut.Donut"
				}
			},
			customizing: {
				"sap.ui.controllerExtensions": {
					"sap.ovp.cards.generic.Card": {
						controllerName: "zui5_zle_aust_mon.ext.donut.Donut"
					}
				}
			},
			version: "1.0.0"
		}
	});
});
