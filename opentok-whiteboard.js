/*!
 *  opentok-whiteboard (http://github.com/aullman/opentok-whiteboard)
 *  
 *  Shared Whiteboard that works with OpenTok
 *
 *  @Author: Adam Ullman (http://github.com/aullman)
 *  @Copyright (c) 2014 Adam Ullman
 *  @License: Released under the MIT license (http://opensource.org/licenses/MIT)
**/

var OpenTokWhiteboard = angular.module('opentok-whiteboard', ['opentok'])
.directive('otWhiteboard', ['OTSession', function (OTSession) {
    return {
        restrict: 'E',
        scope: {
            color: '=',
            lineWidth: "&"
        },
        template: '<canvas></canvas>' + 
            '<select name="color" ng-model="color">' +
            '<option value="black" selected>black</option>' +
            '<option value="blue">blue</option>' +
            '<option value="red">red</option>' +
            '<option value="green">green</option>' +
            '</select>',
        link: function (scope, element, attrs) {
            var canvas = element.context.querySelector("canvas"),
                ctxs = {},
                ctx,
                dragging = false,
                drawHistory = [],
                drawHistoryReceivedFrom,
                drawHistoryReceived,
                batchUpdates = [];

            canvas.width = attrs.width || element.width();
            canvas.height = attrs.height || element.height();
            angular.element(canvas).css({
                width: '100%',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0
            });
            angular.element("select").css({
                position: 'absolute',
                top: 0,
                right: 0
            });
            
            var drawUpdates = function (updates) {
                updates.forEach(function (update) {
                    draw(update);
                });
            };

            var draw = function (update) {
                if (!ctxs.hasOwnProperty(update.id)) {
                    ctx = canvas.getContext("2d");
                    ctx.lineCap = "round";
                    ctx.fillStyle = "solid";
                    ctxs[update.id] = ctx;
                } else {
                    ctx = ctxs[update.id];
                }
                ctx.strokeStyle = update.color;
                ctx.lineWidth = update.lineWidth;
                
                switch (update.type) {
                case 'mousedown':
                    dragging = true;
                    ctx.beginPath();
                    ctx.moveTo(update.x, update.y);
                    break;
                case 'mousemove':
                    if (dragging) {
                        ctx.lineTo(update.x, update.y);
                        ctx.stroke();
                    }
                    break;
                case 'mouseup':
                    dragging = false;
                    ctx.closePath();
                }
                drawHistory.push(update);
            };

            var sendUpdate = function (update) {
                batchUpdates.push(update);
                if (!timeout) {
                    var timeout = setTimeout(function () {
                        OTSession.session.signal({
                            type: 'otWhiteboard_update',
                            data: JSON.stringify(batchUpdates)
                        });
                        batchUpdates = [];
                        timeout = null;
                    }, 100);
                }
            };
            
            angular.element(canvas).on('mousedown mousemove mouseup', function (event) {
                if (event.type === 'mousemove' && !dragging) {
                    // Ignore mouse move Events if we're not dragging
                    return;
                }
                var type = event.type,
                    offset = angular.element(canvas).offset(),
                    scaleX = canvas.width / element.width(),
                    scaleY = canvas.height / element.height(),
                    x = event.offsetX * scaleX,
                    y = event.offsetY * scaleY;
                    
                    var update = {
                        id: OTSession.session.connection.connectionId,
                        x: x,
                        y: y,
                        type: type,
                        color: scope.color,
                        lineWidth: scope.lineWidth()
                    };
                    draw(update);
                    sendUpdate(update);
            });
            
            OTSession.session.on({
                'signal:otWhiteboard_update': function (event) {
                    if (event.from.connectionId !== OTSession.session.connection.connectionId) {
                        drawUpdates(JSON.parse(event.data));
                    }
                },
                'signal:otWhiteboard_history': function (event) {
                    // We will receive these from everyone in the room, only listen to the first
                    // person. Also the data is chunked together so we need all of that person's
                    if (!drawHistoryReceivedFrom || drawHistoryReceivedFrom === event.from.connectionId) {
                        drawHistoryReceivedFrom = event.from.connectionId;
                        if (!drawHistoryReceived) {
                            drawHistoryReceived = [];
                        }
                        drawHistoryReceived.push.apply(drawHistoryReceived, JSON.parse(event.data));
                    }
                },
                'signal:otWhiteboard_historyDone': function (event) {
                    // Wait a second to make sure we got all of the updates
                    // (sometimes they come out of order)
                    setTimeout(function () {
                        if (drawHistoryReceived) {
                            drawUpdates(drawHistoryReceived);
                        }
                    }, 1000);
                },
                connectionCreated: function (event) {
                    if (drawHistory.length > 0 && event.connection.connectionId !==
                            OTSession.session.connection.connectionId) {
                        var historyCopy = Array.prototype.slice.call(drawHistory);
                        // We send the history in small chunks so that they fit in a signal
                        while(historyCopy.length > 0) {
                            var historyChunk = [];
                            while(historyCopy.length > 0 && JSON.stringify(historyChunk).length < 5000) {
                                historyChunk.push(historyCopy.shift());
                            }
                            OTSession.session.signal({
                                to: event.connection,
                                type: 'otWhiteboard_history',
                                data: JSON.stringify(historyChunk)
                            });
                        }
                        OTSession.session.signal({
                            to: event.connection,
                            type: 'otWhiteboard_historyDone'
                        });
                    }
                }
            });
        }
    };
}]);