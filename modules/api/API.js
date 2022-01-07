import { PermissionHelper } from '../helper/PermissionHelper.js';
import { LootSheetNPC5eHelper } from "../helper/LootSheetNPC5eHelper.js";
import { MODULE } from '../data/moduleConstants.js';
import { LootPopulator } from '../classes/LootPopulator.js';
import { TableRoller } from '../classes/TableRoller.js';
import { LootProcessor } from '../classes/LootProcessor.js';
import { currencyHelper } from '../helper/currencyHelper.js';

/**
 * @description The lootsheet API
 *
 * @module lootsheetnpc5e.API
 *
 * @title Lootsheet NPC 5e API
 * @version 1.0.0
 */
class API {

    /**
   * @title Converts the provided token to a lootable sheet
   *
   * @note titleAdapted from dfreds pocketChange Module
   * Originally adappted from the convert-to-lootable.js by @unsoluble, @Akaito, @honeybadger, @kekilla, and @cole.
   *
   * @module lootsheetnpc5e.API.convertToken
   *
   * @param {object} options
   * @param {Token5e} token - the token to convert
   * @param {string} type Type of Lootsheet
   * @param {number} options.chanceOfDamagedItems - (optional) the chance an item is considered damaged from 0 to 1. Uses the setting if undefined
   * @param {number} options.damagedItemsMultiplier - (optional) the amount to reduce the value of a damaged item by. Uses the setting if undefined
   * @param {boolean} options.removeDamagedItems - (optional) if true, removes items that are damaged of common rarity
   */
    static async convertToken(
        token = canvas.tokens.controlled[0],
        type = 'loot',
        options = {},
        verbose = false
    ) {
        let response = API._response(200, 'success');
        if (!token) {
            response.code = 403;
            response.msg = 'No token selected or supplied';
            response.error = true;
            if (verbose) API._verbose(response);
            return response;
        }

        if (!game.user.isGM) return;
        if (!token.actor.sheet) return;

        const sheet = token.actor.sheet,
            priorState = sheet._state; // -1 for opened before but now closed, // 0 for closed and never opened // 1 for currently open

        let lootIcon = 'icons/svg/chest.svg';

        let newActorData = {
            flags: {
                core: {
                    sheetClass: 'dnd5e.LootSheetNPC5e',
                },
                lootsheetnpc5e: {
                    lootsheettype: 'Loot',
                },
            },
        };

        if (type && type.toLowerCase() === 'merchant') {
            newActorData.flags.lootsheetnpc5e.lootsheettype = 'Merchant';
            lootIcon = 'icons/svg/coins.svg';
        }

        // Close the old sheet if it's open
        await sheet.close();

        newActorData.items = LootSheetNPC5eHelper.getLootableItems(
            token.actor.items,
            options
        );

        // Delete all items first
        await token.document.actor.deleteEmbeddedDocuments(
            'Item',
            Array.from(token.actor.items.keys())
        );

        // Update actor with the new sheet and items
        await token.document.actor.update(newActorData);

        // Update the document with the overlay icon and new permissions
        await token.document.update({
            overlayEffect: lootIcon,
            vision: false,
            actorData: {
                actor: {
                    flags: {
                        lootsheetnpc5e: {
                            playersPermission: CONST.ENTITY_PERMISSIONS.OBSERVER,
                        },
                    },
                },
                permission: PermissionHelper._updatedUserPermissions(token),
            },
        });

        // Deregister the old sheet class
        token.actor._sheet = null;
        delete token.actor.apps[sheet.appId];

        if (priorState > 0) {
            // Re-draw the updated sheet if it was open
            token.actor.sheet.render(true);
        }

        response.data = token;
        if (verbose) API._verbose(response);
        return response;
    }

    /**
     * @title convertTokens()
     * @description Convert a stack of Tokens to a given type, apply modifiers if given
     * @module lootsheetnpc5e.API.convertTokens
     *
     * @param {Array<Token5e>} tokens Array of ActorTokens
     * @param {string} type Type of sheet (loot|merchant)
     * @param {object} options
     * @returns {object}
     */
    static async convertTokens(
        tokens,
        type = 'loot',
        options = {},
        verbose = false
    ) {
        const tokenstack = (tokens) ? (tokens.length >= 0) ? tokens : [tokens] : canvas.tokens.controlled;

        let response = API._response(200, 'success');

        for (let token of tokenstack) {
            response.data[token.uuid] = await API.convertToken(token, type, options, verbose)
        }

        if (verbose) API._verbose(response);
        return response;
    }

    /**
     * Roll a table an add the resulting loot to a given token.
     *
     * @param {RollTable} table
     * @param {TokenDocument} token
     * @param {options} object
     * @returns
     */
    static async addLootToSelectedToken(token = null, table = null , options = null) {
        const isTokenActor = (options && options?.isTokenActor),
            stackSame = (options && options?.stackSame) ? options.stackSame : true,
            customRoll = (options && options?.customRole) ? options.customRole : undefined,
            itemLimit = (options && options?.itemLimit) ? Number(options.itemLimit) : 0,
            verboseCall = options?.verbose ?? false;

        let tokenstack = [];

        if (null == token && (canvas.tokens.controlled.length === 0)) {
            return ui.notifications.error('No tokens given or selected');
        } else {
            tokenstack = (token) ? (token.length >= 0) ? token : [token] : canvas.tokens.controlled;
        }

        if (verboseCall)
            ui.notifications.info(MODULE.ns + ' | API | Loot generation started.');

        let tableRoller = new TableRoller(table);

        for (const token of tokenstack) {
            const rollResults = await tableRoller.roll(customRoll, options),
                lootProcess = new LootProcessor(rollResults, token.actor, options),
                betterResults = await lootProcess.buildResults(options);
            //LootCreator(betterResults, currencyData);
            //
            await currencyHelper.addCurrenciesToToken(token, isTokenActor);
            await lootProcess.addItemsToToken(token, stackSame, isTokenActor, itemLimit);
        }

        if (verboseCall)
            return ui.notifications.info(MODULE.ns + ' | API | Loot generation complete.');
    }

    /**
     * @module lootsheetnpc5e.API.makeObservable
     *
     * @description Make the provided tokens observable
     *
     * @param {Token|Array<Token>} tokens A a selection tokens or null (defaults to all controlled tokens)
     * @param {Array<User>|null} players Optional array with users to update (defaults to all)
     *
     * @returns {object} API response object
     */
    static async makeObservable(
        tokens = game.canvas.tokens.controlled,
        players = PermissionHelper.getPlayers(),
        verbose = false
    ) {
        if (!game.user.isGM) return;

        const tokenstack = (tokens) ? (tokens.length >= 0) ? tokens : [tokens] : canvas.tokens.controlled;

        let permissions = false,
            response = API._response(200, 'success'),
            responseData = {},
            tokenData = { actorData: { permission: {} } };

        for (let token of tokenstack) {
            let permissions = PermissionHelper._updatedUserPermissions(token, CONST.ENTITY_PERMISSIONS.OBSERVER, players);
            tokenData.actorData.permission = permissions,
                responseData[token.uuid] = tokenData.actorData.permission;
            await token.update(tokenData);
        }

        response.data = responseData;
        if (verbose) API._verbose(response);
        return response;
    }

    /**
     * @description Return the player(s) current permissions or the tokens default permissions
     *
     * @module lootsheetnpc5e.API.getPermissionForPlayers
     *
     * @param {Token} token token or null (defaults to all controlled tokens)
     * @param {Array<User>|null} players Optional array with users to update (defaults to all)
     * @returns {object} permissions Array of an permission enum values or a single permission
     */
    static getPermissionForPlayers(
        token = canvas.tokens.controlled[0],
        players = PermissionHelper.getPlayers(),
        verbose = false
    ) {
        let response = API._response(200, 'success', {});
        if (!token) {
            response.code = 403;
            response.msg = 'No token selected or supplied';
            if (verbose) API._verbose(response);
            return response;
        }

        for (let player of players) {
            response.data[player.data._id] = PermissionHelper.getLootPermissionForPlayer(token.actor.data, player);
        }

        if (verbose) API._verbose(response);
        return response;
    }

    /**
     * Use the PermissionHelper to update the users permissions for the token
     *
     * @param {Token5e} token
     * @param {number|null} permission enum
     *
     * @return {object} reponse object
     */
    static async updatePermissionForPlayers() {
        let response = API._response(200, permissions, 'success');
        const
            tokens = canvas.tokens.controlled,
            players = PermissionHelper.getPlayers();

        for (let token of tokens) {
            const
                permissions = PermissionHelper._updatedUserPermissions(token, players);

            response.data[token.data.uuid] = permissions;
        }

        if (verbose) API._verbose(response);
        return response;
    }

    static getRegisteredCustomRules() {
        return game.settings.get(MODULE.ns, MODULE.settings.keys.lootpopulator.ruleset);
    }

    /**
     * Update the lootpopulator custom rules
     * Expects a {LootPopulatorRule} object
     *
     * @param {LootPopulatorRule} rule
     */
    static addCustomRule(rule) {
        /**
         * @param {LootPopulatorRule} currentRules
         */
        let currentRules = game.settings.get(MODULE.ns, MODULE.settings.keys.lootpopulator.ruleset);
        game.settings.set(MODULE.ns, MODULE.settings.keys.lootpopulator.ruleset, { ...currentRules, rule });
    }

    /**
     *
     * @param {boolean} state
     */
    static switchPopulatorState(state) {
        game.settings.set(MODULE.ns, MODULE.settings.keys.lootpopulator.autoPopulateTokens, state);
    }

    /**
     * Populate a token with given options
     *
     * @module lootsheetnpc5e.API.populateTokenWithOptions
     *
     * @param {Token} token
     * @param {object} options
     */
    static async populateTokenWithOptions(token, options) {
        await LootPopulator.populate(token, options);
    }

    /**
     * @description Verbose ouput wrapper
     *
     * @module lootsheetnpc5e.API._verbose
     * @param {string} text
     * @private
     */
    static _verbose(data = '') {
        console.log('|--- ' + MODULE.ns + ' API (verbose output) ---|', data, '|--- ' + MODULE.ns + ' API (/verbose output)---|');
    }

    static _response(code, msg = '', data = {}, error = false) {
        return {
            code: code,
            data: data,
            msg: msg,
            error: error
        }
    }
}

export { API };