/*	Dash in panel - GNOME Shell extension - Copyright @fthx 2025 */


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';


const INACTIVE_WORKSPACE_DOT_OPACITY = 168;

const DashPanel = GObject.registerClass(
class DashPanel extends Dash.Dash {
    _init(settings) {
        super._init();

        this._settings = settings;

        this.remove_child(this._dashContainer);

        this.iconSize = this._settings.get_int('icon-size');
        this._setShowAppsButton();

        this._box.connectObject('child-added', (actor, item) => this._setStyle(item), this);
        global.display.connectObject(
            'notify::focus-window', this._onFocusWindowChanged.bind(this),
            'notify::urgent', this._onWindowDemandsAttention.bind(this),
            'window-demands-attention', this._onWindowDemandsAttention.bind(this),
            this);

        this._onFocusWindowChanged();
        if (this._settings.get_boolean('dim-dot')) {
            this._setDotsOpacity();
            global.workspace_manager.connectObject('active-workspace-changed', this._setDotsOpacity.bind(this), this);
        }
    }

    _setStyle(item) {
        if (!item?.child?._dot)
            return;

        item.child.set_style_class_name('dash-in-panel-icon');

        let margin = this._settings.get_int('button-margin');
        item.child.set_style(`margin-left: ${margin}px; margin-right: ${margin}px;`);

        let scaleFactor = global.display.get_monitor_scale(global.display.get_primary_monitor());
        item.child._dot.width = this.iconSize * scaleFactor;
        item.child._dot.height += scaleFactor;
        if (this._settings.get_boolean('colored-dot'))
            item.child._dot.add_style_class_name('dash-in-panel-icon-colored-dot');

        this._timeoutSeparator = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._separator?.add_style_class_name('dash-in-panel-separator');
                if (this._settings.get_boolean('show-running'))
                    this._separator?.hide();

                this._timeoutSeparator = null;
                return GLib.SOURCE_REMOVE;
            });

        if (this._settings.get_boolean('show-label'))
            item.label?.connectObject('notify::visible', () => {
                    this._timeoutLabel = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (!item?.label)
                            return;

                        let yOffset = item.label.get_theme_node().get_length('-y-offset');
                        item.label.y += 2 * item.label.height + 2 * yOffset + (Main.panel.height - 32) / scaleFactor;

                        this._timeoutLabel = null;
                        return GLib.SOURCE_REMOVE;
                    });
                }, this);

        if (this._settings.get_boolean('click-changed'))
            item.child.activate = (button) => this._onClicked(button, item);

        if (this._settings.get_boolean('show-running')) {
            this._setVisible(item);
            item.child.app?.connectObject('notify::state', () => this._setVisible(item), this);
        }
    }

    _setShowAppsButton() {
        if (!this._settings.get_boolean('show-apps')) {
            this.showAppsButton.hide();
            return;
        }

        this._showAppsIcon.icon.setIconSize(this.iconSize);
        this.showAppsButton.add_style_class_name('dash-in-panel-show-apps-button');
        this.showAppsButton.track_hover = true;

        this._dashContainer.set_child_at_index(this.showAppsButton.get_parent(), 0);

        this.showAppsButton.connectObject('clicked', this._onShowAppsClick.bind(this), this);
    }

    _setDotsOpacity() {
        let activeWorkspace = global.workspace_manager.get_active_workspace();

        for (let item of this._dashContainer.last_child?.get_children()) {
            let app_is_on_active_workspace = item.child?.app?.is_on_workspace(activeWorkspace);

            if (app_is_on_active_workspace)
                item.child?._dot?.set_opacity(255);
            else
                item.child?._dot?.set_opacity(INACTIVE_WORKSPACE_DOT_OPACITY);
        }
    }

    _setVisible(item) {
        item.visible = item.child.app?.state == Shell.AppState.RUNNING;
        item.child._dot.visible = false;
    }

    _onFocusWindowChanged() {
        for (let item of this._dashContainer.last_child?.get_children()) {
            let activeWorkspace = global.workspace_manager.get_active_workspace();
            let appHasFocus = item.child?.app?.get_windows().some(
                window => window.appears_focused && window.located_on_workspace(activeWorkspace));

            if (appHasFocus) {
                if (this._settings.get_boolean('colored-dot'))
                    item.child?.add_style_class_name('dash-in-panel-colored-focused-app');
                else
                    item.child?.add_style_class_name('dash-in-panel-focused-app');

                item.child?._dot?.set_opacity(255);
            } else {
                if (this._settings.get_boolean('colored-dot'))
                    item.child?.remove_style_class_name('dash-in-panel-colored-focused-app');
                else
                    item.child?.remove_style_class_name('dash-in-panel-focused-app');
            }
        }
    }

    _onWindowDemandsAttention() {
        for (let item of this._dashContainer.last_child?.get_children()) {
            let appDemandsAttention = item.child?.app?.get_windows().some(window => window.demands_attention);

            if (appDemandsAttention)
                item.child?.add_style_class_name('dash-in-panel-demands-attention-app');
        }
    }

    _onClicked(button, item) {
        item.child?.remove_style_class_name('dash-in-panel-demands-attention-app');

        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;
        let isMiddleButton = button && button === Clutter.BUTTON_MIDDLE;
        let isCtrlPressed = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;
        let openNewWindow = item.child.app?.can_open_new_window() &&
                            item.child.app?.state === Shell.AppState.RUNNING &&
                            (isCtrlPressed || isMiddleButton);

        if (item.child.app?.state === Shell.AppState.STOPPED || openNewWindow)
            item.child.animateLaunch();

        if (openNewWindow)
            item.child.app?.open_new_window(-1);
        else {
            if (this._settings.get_boolean('cycle-windows')) {
                let app_windows = item.child.app
                    .get_windows()
                    .filter(window =>
                        !window.is_override_redirect()
                        && !window.is_attached_dialog()
                        && window.located_on_workspace(global.workspace_manager.get_active_workspace()))
                    .sort((window1, window2) => window1.get_id() - window2.get_id());

                switch (app_windows.length) {
                    case 0:
                        item.child.app.activate();
                    break;
                    case 1:
                        if (app_windows[0].has_focus() && app_windows[0].can_minimize()) {
                            app_windows[0].minimize();
                        } else {
                            if (!app_windows[0].has_focus()) {
                                app_windows[0].activate(global.get_current_time());
                            }
                        }
                    break;
                    default:
                        if (Main.overview.visible) {
                            this.app.activate();
                        } else {
                            let app_has_focus = false;
                            let app_focused_window_index = 0;
                            for (let index = 0; index < app_windows.length; index++) {
                                if (app_windows[index].has_focus()) {
                                    app_has_focus = true;
                                    app_focused_window_index = index;
                                }
                            }

                            if (app_has_focus) {
                                let next_index = (app_focused_window_index + 1) % app_windows.length;
                                item.child.app.activate_window(app_windows[next_index], global.get_current_time());
                            } else
                                item.child.app.activate();
                        }
                }
            } else {
                if (Shell.WindowTracker.get_default().focus_app === item.child.app)
                    global.display.focus_window?.minimize();
                else
                    item.child.app?.activate();
            }
        }

        Main.overview.hide();
    }

    _onShowAppsClick() {
        if (Main.overview.visible)
            Main.overview.dash.showAppsButton.checked = !Main.overview.dash.showAppsButton.checked;
        else
            Main.overview.showApps();
    }

    _queueRedisplay() {
        if (this._workId)
            Main.queueDeferredWork(this._workId);
    }

    _destroy() {
        if (this._timeoutSeparator) {
            GLib.Source.remove(this._timeoutSeparator);
            this._timeoutSeparator = null;
        }

        if (this._timeoutLabel) {
            GLib.Source.remove(this._timeoutLabel);
            this._timeoutLabel = null;
        }

        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._box?.disconnectObject(this);
        this.showAppsButton.disconnectObject(this);
        this._workId = null;

        super.destroy();
    }
});

const DashButton = GObject.registerClass(
class DashButton extends PanelMenu.Button {
    _init(settings) {
        super._init();

        this._settings = settings;

        this.reactive = false;

        this._timeoutDash = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._dash = new DashPanel(this._settings);
            this.add_child(this._dash._dashContainer);

            this._timeoutDash = null;
            return GLib.SOURCE_REMOVE;
        });

        this.connectObject('destroy', this._destroy.bind(this), this);
    }

    _destroy() {
        if (this._timeoutDash) {
            GLib.Source.remove(this._timeoutDash);
            this._timeoutDash = null;
        }

        this._dash?._destroy();
        super.destroy();
    }
});

export default class DashInPanelExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    _moveDate(active) {
        let panel = Main.sessionMode.panel;

        if (active) {
            panel.center = panel.center.filter(item => item !== 'dateMenu');
            panel.right.unshift('dateMenu');
        } else {
            panel.right = panel.right.filter(item => item !== 'dateMenu');
            panel.center.unshift('dateMenu');
        }

        Main.panel._updatePanel();
    }

    _restart() {
        this.disable();
        this.enable();
    }

    enable() {
        this._settings = this.getSettings();

        let scaleFactor = global.display.get_monitor_scale(global.display.get_primary_monitor());
        Main.panel.height = this._settings.get_int('panel-height') * scaleFactor;

        if (this._settings.get_boolean('scroll-panel'))
            Main.panel.connectObject('scroll-event', (actor, event) => Main.wm.handleWorkspaceScroll(event), this);

        if (this._settings.get_boolean('move-date'))
            this._moveDate(true);
            
        if (this._settings.get_boolean('hide-activities-bt')) {
            if (Main.panel.statusArea["activities"] != null) {
                Main.panel.statusArea["activities"].hide();
            }
        } else {
            if (Main.panel.statusArea["activities"] != null) {
                Main.panel.statusArea["activities"].show();
            }
        }

        if (!this._settings.get_boolean('show-dash')) {
            Main.overview.dash.height = 0;
            Main.overview.dash.hide();
        }

        if (!this._settings.get_boolean('show-overview') && Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => Main.overview.hide(), this);

        this._dashButton = new DashButton(this._settings);
        if (this._settings.get_boolean('center-dash'))
            Main.panel.addToStatusArea('dash', this._dashButton, -1, 'center');
        else
            Main.panel.addToStatusArea('dash', this._dashButton, -1, 'left');

        this._settings.connectObject('changed', this._restart.bind(this), this);
        Main.layoutManager.connectObject('monitors-changed', this._restart.bind(this), this);
    }

    disable() {
        this._settings.disconnectObject(this);
        this._settings = null;

        this._dashButton?.destroy();
        this._dashButton = null;

        Main.layoutManager.disconnectObject(this);

        Main.overview.dash.show();
        Main.overview.dash.height = -1;
        Main.overview.dash.setMaxSize(-1, -1);

        this._moveDate(false);
        Main.panel.disconnectObject(this);
        Main.panel.height = -1;
    }
}
