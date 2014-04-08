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
.directive('otWhiteboard', ['OTSession', '$window', function (OTSession, $window) {
    return {
        restrict: 'E',
        template: '<canvas></canvas>' + 
            '<input type="button" ng-click="clear()" value="Clear"></input>' +
            '<select name="color" ng-model="color" ng-options="c for c in colors">' +
            '</select>',
        link: function (scope, element, attrs) {
            var canvas = element.context.querySelector("canvas"),
                select = element.context.querySelector("select"),
                input = element.context.querySelector("input"),
                clients = {},
                thisClient = {dragging:false},
                ctx,
                drawHistory = [],
                drawHistoryReceivedFrom,
                drawHistoryReceived,
                lineWidth = 2,
                batchUpdates = [];

            scope.colors = ['black', 'blue', 'red', 'green', 'orange', 'purple', 'brown'];
            scope.color = scope.colors[Math.floor(Math.random() * scope.colors.length)];
            
            scope.colors.forEach(function (color) {
                var option = document.createElement('option');
                option.value = color;
                option.innerHTML = color;
                select.appendChild(option);
            });

            canvas.width = attrs.width || element.width();
            canvas.height = attrs.height || element.height();
            angular.element(canvas).css({
                width: '100%',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0
            });
            angular.element(select).css({
                position: 'absolute',
                top: 0,
                right: 0,
                height: "20px"
            });
            angular.element(input).css({
                position: 'absolute',
                top: "20px",
                right: 0
            });
            
            var drawUpdates = function (updates) {
                updates.forEach(function (update) {
                    draw(update);
                });
            };
            
            var clearCanvas = function () {
                ctx.save();

                // Use the identity matrix while clearing the canvas
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Restore the transform
                ctx.restore();
                drawHistory = [];
            };
            
            scope.clear = function () {
                clearCanvas();
                if (OTSession.session) {
                    OTSession.session.signal({
                        type: 'otWhiteboard_clear'
                    });
                }
            };

            var draw = function (update) {
                if (!ctx) {
                    ctx = canvas.getContext("2d");
                    ctx.lineCap = "round";
                    ctx.fillStyle = "solid";
                }
                if (!clients.hasOwnProperty(update.id)) {
                    if (OTSession.session && OTSession.session.connection &&
                            OTSession.session.connection.connectionId === update.id) {
                        clients[update.id] = thisClient;
                    } else {
                        clients[update.id] = {dragging: false};
                    }
                }
                client = clients[update.id];

                ctx.strokeStyle = update.color;
                ctx.lineWidth = update.lineWidth;
                
                switch (update.type) {
                case 'mousedown':
                case 'touchstart':
                    client.dragging = true;
                    break;
                case 'mousemove':
                case 'touchmove':
                    if (client.dragging) {
                        ctx.beginPath();
                        ctx.moveTo(client.lastX, client.lastY);
                        ctx.lineTo(update.x, update.y);
                        ctx.stroke();
                        ctx.closePath();
                    }
                    break;
                case 'mouseup':
                case 'touchend':
                case 'mouseout':
                case 'blur':
                    client.dragging = false;
                }
                client.lastX = update.x;
                client.lastY = update.y;
                drawHistory.push(update);
            };
            
            var updateTimeout;
            var sendUpdate = function (update) {
                if (OTSession.session) {
                    batchUpdates.push(update);
                    if (!updateTimeout) {
                        updateTimeout = setTimeout(function () {
                            OTSession.session.signal({
                                type: 'otWhiteboard_update',
                                data: JSON.stringify(batchUpdates)
                            });
                            batchUpdates = [];
                            updateTimeout = null;
                        }, 100);
                    }
                }
            };
            
            angular.element(canvas).on('mousedown mousemove mouseup mouseout touchstart touchmove touchend', function (event) {
                event.preventDefault();
                if (event.type === 'mousemove' && !thisClient.dragging) {
                    // Ignore mouse move Events if we're not dragging
                    return;
                }
                var type = event.type,
                    offset = angular.element(canvas).offset(),
                    scaleX = canvas.width / element.width(),
                    scaleY = canvas.height / element.height(),
                    offsetX = event.offsetX || event.originalEvent.pageX - offset.left,
                    offsetY = event.offsetY || event.originalEvent.pageY - offset.top,
                    x = offsetX * scaleX,
                    y = offsetY * scaleY;
                    
                    var update = {
                        id: OTSession.session && OTSession.session.connection &&
                            OTSession.session.connection.connectionId,
                        x: x,
                        y: y,
                        type: type,
                        color: scope.color,
                        lineWidth: lineWidth
                    };
                    draw(update);
                    sendUpdate(update);
            });
            
            if (OTSession.session) {
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
                    'signal:otWhiteboard_clear': function (event) {
                        if (event.from.connectionId !== OTSession.session.connection.connectionId) {
                            clearCanvas();
                        }
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
        }
    };
}]);