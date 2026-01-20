/*:
 * @plugindesc 消息回放窗口（在地图中按指定快捷键使用）
 * @author Errno
 * @help 
 *
 * @param key
 * @type string
 * @desc 调用消息回放窗口的按键
 * @default tab
*/

(function(){
	var pluginParameters = PluginManager.parameters('message_replay');
    var inputKeyCallMessageReplay = pluginParameters['key'] || 'tab';

    /**
     * MomentumScroller
     * 
     * 用于实现带有惯性滚动效果的滚动器类
     */
    function MomentumScroller() {
        this.initialize.apply(this, arguments);
    }
    MomentumScroller.prototype = Object.create(Object.prototype);
    MomentumScroller.prototype.constructor = MomentumScroller;

    MomentumScroller.prototype.initialize = function(range, initial=0, max_velocity=100, friction=0.98, acceleration=5, pull_acceleration=null) {
        this.range = range;
        this.max_velocity = max_velocity;
        this.friction = friction;
        this.acceleration = acceleration;
        this.pull_acceleration = pull_acceleration || acceleration * 4;
        this._velocity = 0;
        this._position = initial;
    }

    MomentumScroller.prototype.update = function() {
        if (Math.abs(this._velocity) < 1e-6) {
            this._velocity = 0;
            return;
        }
        this._position += this._velocity;
        this._position = Math.max(0, Math.min(this.range, this._position));
        this._velocity *= this.friction;
    }

    MomentumScroller.prototype.scroll = function(value) {
        var pull = Math.sign(value) * Math.sign(this._velocity) < 0;
        this._velocity += value * (pull ? this.pull_acceleration : this.acceleration);
        if (pull && Math.sign(this._velocity) === Math.sign(value)) {
            this._velocity = 0;
        } else {
            this._velocity = Math.max(-this.max_velocity, Math.min(this._velocity, this.max_velocity));
        }
    }

    MomentumScroller.prototype.getPosition = function () {
        return this._position;
    }

    MomentumScroller.prototype.setPosition = function (value) {
        this._position = value;
    }

    MomentumScroller.prototype.stop = function (value) {
        this._velocity = 0;
    }

    /**
     * MessageQueue
     * 
     * 用于存储和管理消息队列的类
     */
    function MessageQueue() {
        this.initialize.apply(this, arguments);
    }
    MessageQueue.prototype = Object.create(Object.prototype);
    MessageQueue.prototype.constructor = MessageQueue;
    
    MessageQueue.prototype.initialize = function(capacity=100) {
        this._messages = [];
        this._p = 0;
        this._capacity = capacity + 1;
        this._internalId = 0;
    };
    MessageQueue.prototype._preprocess = function(message) {
        switch (message.type) {
            case 0:
                // text message
                message.text = Window_Message.prototype.convertEscapeCharacters.call(this, message.text);
                var new_text = [], text_buf = "";
                for (var i = 0; i < message.text.length; ++i) {
                    var c = message.text.charAt(i);
                    switch (c) {
                        case '\n':
                            new_text.push({command: "text", text: text_buf});
                            new_text.push({command: "newline"});
                            text_buf = "";
                            break;
                        case '\x1b':
                            new_text.push({command: "text", text: text_buf});
                            text_buf = "";
                            var dummyTextState = {text: message.text, index: i, x: 0, y: 0, left: 0, height: 0};
                            var escapeCode = Window_Message.prototype.obtainEscapeCode.call(this, dummyTextState);
                            switch (escapeCode) {
                                case 'C': 
                                    var textColor = Window_Message.prototype.obtainEscapeParam.call(this, dummyTextState);
                                    new_text.push({command: "color", color: textColor});
                                    break;
                                case 'I':
                                    var iconIndex = Window_Message.prototype.obtainEscapeParam.call(this, dummyTextState);
                                    new_text.push({command: "icon", iconIndex: iconIndex});
                                    break;
                                case '{':
                                    new_text.push({command: "bigfont"});
                                    break;
                                case '}':
                                    new_text.push({command: "smallfont"});
                                    break;
                            }
                            i = dummyTextState.index - 1;
                            break;
                        default:
                            text_buf += c;
                    }
                }
                if (text_buf.length > 0) {
                    new_text.push({command: "text", text: text_buf});
                }
                message.text = new_text;
                break;
        }
        message.id = this._internalId++;
        return message;
    };
    MessageQueue.prototype.enqueue = function(message) {
        message = this._preprocess(message);
        if (this._messages.length >= this._capacity) {
            this._messages[this._p++] = message;
            if (this._p >= this._capacity) {
                this._p = 0;
            }
        } else {
            this._messages.push(message);
        }
    };
    MessageQueue.prototype.forEach = function(callback) {
        var size = this._messages.length < this._capacity ? this._messages.length : this._capacity - 1;
        for (var i = 0, p; i < size; i++) {
            p = (this._p + i) % this._messages.length;
            callback(this._messages[p], p);
        }
    };
    MessageQueue.prototype.isFull = function() {
        return this._messages.length >= this._capacity;
    };
    MessageQueue.prototype.getData = function() {
        var data = {"messages": this._messages.slice(), "p": this._p, "capacity": this._capacity, "internalId": this._internalId};
        return data;
    };
    MessageQueue.prototype.setData = function(data) {
        this._messages = data.messages;
        this._p = data.p;
        this._capacity = data.capacity;
        this._internalId = data.internalId;
    };
    
    /**
     * Window_MessageTag
     * 
     * 用于显示单条消息的窗口类
     */
    function Window_MessageTag() {
        this.initialize.apply(this, arguments);
    }
    Window_MessageTag.prototype = Object.create(Window_Base.prototype);
    Window_MessageTag.prototype.constructor = Window_MessageTag;
    
    Window_MessageTag.prototype.initialize = function(message, width, padding=2) {
        this._message = message;
        this._windowPadding = padding;
        Window_Base.prototype.initialize.call(this, 0, 0, width, 1);
        this.updatePadding();
        var height = this._getHeight();
        this.height = height + 2 * this.standardPadding();
        this.contents = new Bitmap(this.contentsWidth(), this.contentsHeight());
        this.refresh();
    }

    Window_MessageTag.prototype.standardPadding = function() {
        return this._windowPadding;
    }
    
    Window_MessageTag.prototype._getHeight = function() {
        var ty = 0, message = this._message;
        this.resetFontSettings();
        switch (message.type) {
            case 0:
                // text message
                var trailing = true;
                for (var i = 0; i < message.text.length; ++i) {
                    var cmd = message.text[i], maxFontSize = this.contents.fontSize;
                    switch (cmd.command) {
                        case "text":
                            trailing = false;
                            break;
                        case "newline":
                            trailing = true;
                            ty += maxFontSize + 8;
                            break;
                        case "icon":
                            maxFontSize = Math.max(maxFontSize, Window_Base._iconHeight + 4);
                            break;
                        case "bigfont":
                            this.makeFontBigger();
                            maxFontSize = Math.max(maxFontSize, this.contents.fontSize);
                            break;
                        case "smallfont":
                            this.makeFontSmaller();
                            break;
                    }
                }
                if (!trailing) {
                    ty += maxFontSize + 8;
                }
                if (message.params[0] && message.params[0] !== "") {
                    ty = Math.max(ty, Window_Base._faceHeight + 8);
                }
                break;
            case 1:
                // choice
                var choices = message.choices.slice(), hasCancel = message.cancelType < -1;
                var choicePadding = 16, maxSize = this.contents.width - 2 * this._windowPadding - choicePadding, choiceLayers = [], choiceBuf = [], currentSize = 0;
                if (hasCancel) {
                    choices.push("(取消)");
                }
                choices.forEach((element, index) => {
                    var textWidth = this.textWidth(element), color = this.textColor(0);
                    if ((currentSize += textWidth + choicePadding) > maxSize) {
                        choiceLayers.push(choiceBuf);
                        choiceBuf = [];
                        currentSize = textWidth + choicePadding;
                    }
                    choiceBuf.push(textWidth);
                });
                if (choiceBuf.length > 0) {
                    choiceLayers.push(choiceBuf);
                }
                ty += choiceLayers.length * (this.contents.fontSize + 8);
                break;
            case 2:
                // number input
                ty += this.contents.fontSize + 8;
                break;
            case 3:
                // item choice
                var item = message.itemId ? $dataItems[message.itemId] : null;
                if (item) {
                    ty += Math.max(Window_Base._iconHeight + 4, this.contents.fontSize) + 8;
                } else {
                    ty += this.contents.fontSize + 8;
                }
                break;
            case 4:
                // line
                ty += 2;
                break;
            case 5:
                // dots
                ty += this.contents.fontSize;
            }
        return ty;
    };
    
    Window_MessageTag.prototype.drawMessage = function(padding=0) {
        var x = padding, y = padding, tx = padding, ty = padding, message = this._message;
        this.contents.clear();
        this.resetTextColor();
        this.resetFontSettings();
        switch (message.type) {
            case 0:
                // text message
                var _imageReservationId = Utils.generateRuntimeId(), faceBitmap = ImageManager.reserveFace(message.params[0], 0, this._imageReservationId);
                if (faceBitmap && faceBitmap.isReady() && faceBitmap._image) {
                    this.drawFace(message.params[0], message.params[1], x, y);
                    ImageManager.releaseReservation(_imageReservationId);
                    tx = x += 168;
                }
                var trailing = true, maxFontSize = this.contents.fontSize;
                for (var i = 0; i < message.text.length; ++i) {
                    var cmd = message.text[i];
                    switch (cmd.command) {
                        case "text":
                            trailing = false;
                            this.drawText(cmd.text, tx, ty);
                            tx += this.textWidth(cmd.text);
                            break;
                        case "newline":
                            trailing = true;
                            tx = x;
                            ty += maxFontSize + 8;
                            break;
                        case "color":
                            this.changeTextColor(this.textColor(cmd.color));
                            break;
                        case "icon":
                            this.drawIcon(cmd.iconIndex, tx + 2, ty + 2);
                            tx += Window_Base._iconWidth + 4;
                            maxFontSize = Math.max(maxFontSize, Window_Base._iconHeight + 4);
                            break;
                        case "bigfont":
                            this.makeFontBigger();
                            maxFontSize = Math.max(maxFontSize, this.contents.fontSize);
                            break;
                        case "smallfont":
                            this.makeFontSmaller();
                            break;
                    }
                }
                if (!trailing) {
                    ty += maxFontSize + 8;
                }
                if (faceBitmap && faceBitmap.isReady() && faceBitmap._image) {
                    ty = Math.max(ty, y + Window_Base._faceHeight + 8);
                }
                break;
            case 1:
                // choice
                var choices = message.choices.slice(), hasCancel = message.cancelType < -1;
                var choicePadding = 16, maxSize = this.contents.width - 2 * x - choicePadding, choiceLayers = [], choiceBuf = [], currentSize = 0;
                if (hasCancel) {
                    choices.push("(取消)");
                }
                choices.forEach((element, index) => {
                    var textWidth = this.textWidth(element), color = this.textColor(0);
                    if ((currentSize += textWidth + choicePadding) > maxSize) {
                        choiceLayers.push(choiceBuf);
                        choiceBuf = [];
                        currentSize = textWidth + choicePadding;
                    }
                    if (index == message.choiceIndex || (hasCancel && index == choices.length - 1 && message.isCancel)) {
                        color = this.systemColor();
                    }
                    else if (hasCancel && index == choices.length - 1) {
                        color = this.textColor(8);
                    }
                    choiceBuf.push({choice: element, color: color, width: textWidth});
                });
                if (choiceBuf.length > 0) {
                    choiceLayers.push(choiceBuf);
                }
                choiceLayers.forEach((layer) => {
                    var totalWidth = choicePadding * (layer.length + 1), span = 0, tx = x + choicePadding;
                    layer.forEach((element) => {
                        totalWidth += element.width + choicePadding;
                    });
                    span = (this.contents.width - totalWidth - choicePadding - 2 * x) / layer.length;
                    layer.forEach((element) => {
                        this.changeTextColor(element.color);
                        this.drawText(element.choice, tx + (element.width + span) / 2, ty, element.width, this.lineHeight(), 'left');
                        tx += element.width + choicePadding + span;
                    });
                    ty += this.contents.fontSize + 8;
                });
                break;
            case 2:
                // number input
                tx = this.contents.width - x, ty = y;
                var text = message.number.toString(), textWidth = this.textWidth(text);
                this.drawText(text, tx - textWidth, ty, textWidth, this.lineHeight(), 'left');
                ty += this.contents.fontSize + 8;
                break;
            case 3:
                // item choice
                tx = this.contents.width - x, ty = y;
                var item = message.itemId ? $dataItems[message.itemId] : null, itemName = item ? item.name : "(取消)";
                var iconWidth = Window_Base._iconWidth + 4, textWidth = this.textWidth(itemName);
                if (item) {
                    this.drawItemName(item, tx - textWidth - iconWidth, ty + 2);
                    ty += Math.max(Window_Base._iconHeight + 4, this.contents.fontSize) + 8;
                } else {
                    this.drawText(itemName, tx - textWidth, ty, textWidth, this.lineHeight(), 'left');
                    ty += this.contents.fontSize + 8;
                }
                break;
            case 4:
                // line
                this.contents.fillRect(x, ty, this.contents.width - x, 2, this.textColor(7));
                ty += 2;
                break;
            case 5:
                // dots
                var dotWidth = this.textWidth("...");
                this.drawText("...", (this.contents.width - dotWidth) / 2, ty, dotWidth, this.contents.fontSize, "left");
                ty += this.contents.fontSize;
                break;
        }
        return ty + padding;
    }
    
    Window_MessageTag.prototype.refresh = function() {
        this.drawMessage(0);
    }
    
    Window_MessageTag.prototype._refreshFrame = function() {
        if (this._windowFrameSprite) {
            this._windowFrameSprite.visible = false;
        }
    };
    
    Window_MessageTag.prototype._refreshBack = function() {
        if (this._windowBackSprite) {
            this._windowBackSprite.visible = false;
        }
    };
    
    Window_MessageTag.prototype.getInternalId = function() {
        return this._message.id;
    }
    
    /**
     * Window_MessageReplay
     * 
     * 用于显示消息回放窗口的类
     */
    function Window_MessageReplay() {
        this.initialize.apply(this, arguments);
    }
    Window_MessageReplay.prototype = Object.create(Window_Base.prototype);
    Window_MessageReplay.prototype.constructor = Window_MessageReplay;
    
    Window_MessageReplay.prototype.initialize = function(x, y, width, height) {
        x = x || 0
        this.baseY = y || 0
        width = width || Graphics.boxWidth;
        this._frameHeight = height || Graphics.boxHeight;
        Window_Base.prototype.initialize.call(this, x, this.baseY, width, this._frameHeight);
        this.openness = 0;
        this._tagWindows = {};
        this._dividerWindows = {};
        this._lastDividerId = null;
        this._dotWindow = new Window_MessageTag({type: 5}, this.contentsWidth(), 0);
        this._dotWindow.x = this.standardPadding();
        this.scrollY = 0;
        this._contentsHeight = 0;
        this._momentumScroller = null;
        this.addChild(this._dotWindow);
        this.refresh();
    };

    Window_MessageReplay.prototype.updateOpen = function() {
        if (this._opening) {
            this.openness += 16;
            if (this.isOpen()) {
                this._opening = false;
            }
            this.contentsOpacity = this.openness;
        }
    };
    
    Window_MessageReplay.prototype.update = function() {
        if (this.isOpening() || this.isClosing()) {
            this._setWindowsPosition();
        }
        Window_Base.prototype.update.call(this);
        while (!this.isOpening() && !this.isClosing()) {
            if (this.updateInput()) {
                return;
            } else if (this.canStart()) {
                this.open();
                this.refresh();
            } else if (this.updateScrollBar()) {
                return;
            } else {
                return;
            }
        }
    };

    Window_MessageReplay.prototype.updateScrollBar = function () {
        if (this._momentumScroller) {
            this._momentumScroller.update();
            this.scrollTo(this._momentumScroller.getPosition());
        }
        return false;
    }
    
    Window_MessageReplay.prototype.terminate = function() {
        this.close();
    };
    
    Window_MessageReplay.prototype.updateInput = function() {
        if (this.isOpen()) {
            if (Input.isTriggered('cancel') || Input.isTriggered(inputKeyCallMessageReplay)) {
                Input.update();
                this.terminate();
                return true;
            }
            if (this._momentumScroller) {
                if (Input.isRepeated('up')) {
                    this._momentumScroller.scroll(-2);
                    return true;
                }
                if (Input.isRepeated('down')) {
                    this._momentumScroller.scroll(2);
                    return true;
                }
                if (Input.isRepeated('pageup')) {
                    this._momentumScroller.stop();
                    this._momentumScroller.setPosition(this._momentumScroller.getPosition() - this._frameHeight * 4 / 5);
                    return true;
                }
                if (Input.isRepeated('pagedown')) {
                    this._momentumScroller.stop();
                    this._momentumScroller.setPosition(this._momentumScroller.getPosition() + this._frameHeight * 4 / 5);
                    return true;
                }
                if (TouchInput.wheelY !== 0) {
                    this._momentumScroller.scroll(Math.sign(TouchInput.wheelY));
                    return true;
                }
            }
        }
        return false;
    };
    
    Window_MessageReplay.prototype.canStart = function() {
        if (!this.isOpen() && $gamePlayer.canMove() && !$gameMessage.isBusy()) {
            return Input.isTriggered(inputKeyCallMessageReplay);
        }
    }
    
    Window_MessageReplay.prototype.refresh = function() {
        var y = 0, first = true, tagWindows = {}, contentsCommand = [], updated = false, lastDivider = null;
        for (var id in this._tagWindows) {
            tagWindows[id] = this._tagWindows[id];
        }
        $gameMessage.messageQueue.forEach((message) => {
            if (first) {
                first = false;
                if ($gameMessage.messageQueue.isFull()) {
                    this._dotWindow.visible = true;
                    this._dotWindow.baseY = y + this.standardPadding();
                    y += this._dotWindow.height;
                } else {
                    this._dotWindow.visible = false;
                }
            }
            if (message.id in tagWindows) {
                var tagWindow = tagWindows[message.id];
                lastDivider = this._dividerWindows[message.id];
                delete tagWindows[message.id];
            } else {
                var tagWindow = new Window_MessageTag(message, this.width, 18);
                this._tagWindows[message.id] = tagWindow;
                this.addChild(tagWindow);
                lastDivider = new Window_MessageTag({type: 4}, this.contentsWidth(), 0);
                lastDivider.x = this.standardPadding();
                this._dividerWindows[message.id] = lastDivider;
                this.addChild(lastDivider);
                updated = true;
            }
            tagWindow.opacity = 255;
            tagWindow.x = this.standardPadding();
            tagWindow.y = tagWindow.baseY = y + this.standardPadding();
            y += tagWindow.height;
            this._lastDividerId = message.id;
            lastDivider.opacity = 255;
            lastDivider.x = this.standardPadding();
            lastDivider.y = lastDivider.baseY = y + this.standardPadding();
            y += lastDivider.height;
        });
        for (var id in tagWindows) {
            var tagWindow = tagWindows[id], dividerWindow = this._dividerWindows[id];
            this.removeChild(tagWindow);
            this.removeChild(dividerWindow);
            delete this._tagWindows[id];
            delete this._dividerWindows[id];
            updated = true;
        }
        if (lastDivider) {
            lastDivider.opacity = 0;
            y -= lastDivider.height;
        }
        this._contentsHeight = Math.max(y + 2 * this.standardPadding(), this._frameHeight);
        this.setBackgroundType(1);
        this.scrollTo(updated ? this._contentsHeight - this._frameHeight : this.scrollY);
        if (this._contentsHeight > this._frameHeight) {
            this._momentumScroller = new MomentumScroller(this._contentsHeight - this._frameHeight, this.scrollY, 100, 0.98, 5);
        } else {
            this._momentumScroller = null;
        }
    };
    
    Window_MessageReplay.prototype._setChildWindowPosition = function(tagWindow) {
        var alpha = 0;
        if (tagWindow.baseY + tagWindow.height < this.scrollY) {
            alpha = 0;
        } else if (tagWindow.baseY < this.scrollY) {
            alpha = 1 - (this.scrollY - tagWindow.baseY) / tagWindow.height;
        } else if (tagWindow.baseY + tagWindow.height < this.scrollY + this._frameHeight) {
            alpha = 1;
        } else if (tagWindow.baseY < this.scrollY + this._frameHeight) {
            alpha = (this.scrollY + this._frameHeight - tagWindow.baseY) / tagWindow.height;
        } else {
            alpha = 0;
        }       
        tagWindow.contentsOpacity = Math.round(this.openness * alpha);
        tagWindow.y = tagWindow.baseY - this.scrollY;
    }

    Window_MessageReplay.prototype._setWindowsPosition = function() {
        if (this._contentsHeight <= this._frameHeight) {
            this.scrollY = 0;
            for (var id in this._tagWindows) {
                var tagWindow = this._tagWindows[id], dividerWindow = this._dividerWindows[id];
                tagWindow.y = tagWindow.baseY;
                dividerWindow.y = dividerWindow.baseY;
            }
        } else {
            var maxScrollY = this._contentsHeight - this._frameHeight;
            this.scrollY = Math.max(0, Math.min(this.scrollY, maxScrollY));
            this._setChildWindowPosition(this._dotWindow);
            for (var id in this._tagWindows) {
                var tagWindow = this._tagWindows[id], dividerWindow = this._dividerWindows[id];
                this._setChildWindowPosition(tagWindow);
                if (dividerWindow && id != this._lastDividerId) {
                    this._setChildWindowPosition(dividerWindow);
                }
            }
        }
    };
    
    Window_MessageReplay.prototype.scrollTo = function(position) {
        this.scrollY = position;
        this._setWindowsPosition();
    };
    
    /**
     * 内置函数重载
     */
    var _gameMessage_initialize = Game_Message.prototype.initialize;
    Game_Message.prototype.initialize = function() {
        _gameMessage_initialize.call(this);
        this.messageQueue = new MessageQueue(100);
    };

    var _gameInterpreter_command101 = Game_Interpreter.prototype.command101;
    Game_Interpreter.prototype.command101 = function() {
        var _index = this._index, params = this._params, text = "", i = _index + 1;
        while (this._list[i] && this._list[i].code === 401) {
            text += this._list[i++].parameters[0] + '\n';
        }
        var result = _gameInterpreter_command101.call(this);
        if (_index !== this._index) {
            // successfully executed
            $gameMessage.messageQueue.enqueue({
                "type": 0,
                "text": text,
                "params": params.slice()
            })
        }
        return result;
    };
    
    var _gameMessage_onChoice = Game_Message.prototype.onChoice;
    Game_Message.prototype.onChoice = function(n) {
        var cancelType = $gameMessage.choiceCancelType(), cancelEnabled = cancelType !== -1;
        $gameMessage.messageQueue.enqueue({
            "type": 1,
            "position": this._choicePositionType,
            "choices": this._choices.slice(),
            "choiceIndex": n,
            "cancelType": cancelType,
            "isCancel": cancelEnabled && n === cancelType
        });
        _gameMessage_onChoice.call(this, n);
    };
    var _windowNumberInput_processOk = Window_NumberInput.prototype.processOk;
    Window_NumberInput.prototype.processOk = function() {
        $gameMessage.messageQueue.enqueue({
            "type": 2,
            "varId": $gameMessage.numInputVariableId(),
            "number": this._number
        });
        _windowNumberInput_processOk.call(this);
    };
    var _windowEventItem_onOk = Window_EventItem.prototype.onOk;
    Window_EventItem.prototype.onOk = function() {
        $gameMessage.messageQueue.enqueue({
            "type": 3,
            "itemId": this.item().id,
            "varId": $gameMessage.itemChoiceVariableId()
        });
        _windowEventItem_onOk.call(this);
    };
    var _windowEventItem_onCancel = Window_EventItem.prototype.onCancel;
    Window_EventItem.prototype.onCancel = function() {
        $gameMessage.messageQueue.enqueue({
            "type": 3,
            "itemId": 0,
            "varId": $gameMessage.itemChoiceVariableId()
        });
        _windowEventItem_onCancel.call(this);
    };
    
    var _sceneMap_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function() {
        _sceneMap_createAllWindows.call(this);
        this._messageReplayWindow = new Window_MessageReplay();
        this.addWindow(this._messageReplayWindow);
    };
    
    var _sceneMap_isSceneChangeOk = Scene_Map.prototype.isSceneChangeOk;
    Scene_Map.prototype.isSceneChangeOk = function() {
        if (this._messageReplayWindow.isOpen()) {
            return false;
        }
        return _sceneMap_isSceneChangeOk.call(this);
    };

    var _gamePlayer_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if (SceneManager._scene instanceof Scene_Map) {
            var scene = SceneManager._scene;
            if (scene._messageReplayWindow && scene._messageReplayWindow.isOpen()) {
                return false;
            }
        }
        return _gamePlayer_canMove.call(this);
    };

    // Messages are too big to save
    /*
        var _dataManager_makeSaveContents = DataManager.makeSaveContents;
        DataManager.makeSaveContents = function() {
            var contents = _dataManager_makeSaveContents.call(this);
            contents.messageReplay = $gameMessage.messageQueue.getData();
            return contents;
        };

        var _dataManager_extractSaveContents = DataManager.extractSaveContents;
        DataManager.extractSaveContents = function(contents) {
            _dataManager_extractSaveContents.call(this, contents);
            if (contents.messageReplay) {
                $gameMessage.messageQueue.setData(contents.messageReplay);
            }
        };
    */
})();