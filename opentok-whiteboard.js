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

            '<div class="OT_panel">' +

            '<input type="button" ng-class="{OT_color: true, OT_selected: c[\'background-color\'] === color}" ' +
            'ng-repeat="c in colors" ng-style="c" ng-click="changeColor(c)">' +
            '</input>' +

            '<input type="button" ng-click="erase()" ng-class="{OT_erase: true, OT_selected: erasing}"' +
            ' value="Eraser"></input>' +
            
            '<input type="button" ng-click="capture()" class="OT_capture" value="{{captureText}}"></input>' +

            '<input type="button" ng-click="undo()" class="OT_capture" value="Undo"></input>' +

            '<input type="button" ng-click="redo()" class="OT_capture" value="Redo"></input>' +

            '<input type="button" ng-click="clear()" class="OT_clear" value="Clear"></input>',

        link: function (scope, element, attrs) {
            var canvas = element.context.querySelector("canvas"),
                select = element.context.querySelector("select"),
                input = element.context.querySelector("input"),
                client = {dragging:false},
                ctx,
                start = 0, //Grabs the end position of each stroke
                count = 0, //Grabs the total count of each continuous stroke
                undoStack = [], //Stores the value of start and count for each continuous stroke
                redoStack = [], //When undo pops, data is sent to redoStack
                drawHistory = [],
                drawHistoryReceivedFrom,
                drawHistoryReceived,
                batchUpdates = [],
                iOS = /(iPad|iPhone|iPod)/g.test( navigator.userAgent );
                

            // Create an empty project and a view for the canvas:
            paper.setup(canvas);

            scope.colors = [{'background-color': 'black'},
                            {'background-color': 'blue'},
                            {'background-color': 'red'},
                            {'background-color': 'green'},
                            {'background-color': 'orange'},
                            {'background-color': 'purple'},
                            {'background-color': 'brown'}];
            scope.captureText = iOS ? 'Email' : 'Capture';
            
            scope.strokeCap = 'round';
            scope.strokeJoin = 'round';

            canvas.width = attrs.width || element.width();
            canvas.height = attrs.height || element.height();
            
            if (!ctx) {
              ctx = canvas.getContext("2d");
            }
            
            var clearCanvas = function () {
	            	paper.project.clear();
	            	paper.view.update();
            };

            var clearStack = function () {
                drawHistory = [];
                undoStack = [];
                redoStack = [];
                start = 0;
                count = 0;
            }
            
            scope.changeColor = function (color) {
                scope.color = color['background-color'];
                scope.lineWidth = 2;
                scope.erasing = false;
            };
            
            scope.changeColor(scope.colors[Math.floor(Math.random() * scope.colors.length)]);
            
            scope.clear = function () {
                clearCanvas();
                if (OTSession.session) {
                    OTSession.session.signal({
                        type: 'otWhiteboard_clear'
                    });
                }
            };
            
            scope.erase = function () {
                //scope.color = element.css("background-color") || "#fff";
                scope.lineWidth = 50;
                scope.erasing = true;
            };
            
            scope.capture = function () {
                if (iOS) {
                    // On iOS you can put HTML in a mailto: link
                    window.location.href = "mailto:?subject=Whiteboard&Body=<img src='" + canvas.toDataURL('image/png') + "'>";
                } else {
                    // We just open the image in a new window
                    window.open(canvas.toDataURL('image/png'));
                }
            };

            scope.undo = function () {
                if (!undoStack.length)
                    return;
                var undodata = undoStack.pop();
                undoWhiteBoard(undodata);
                redoStack.push(undodata);
                sendUpdate('otWhiteboard_undo', undodata);
            };

            var undoWhiteBoard = function (data) {
	            data.visible = false;
	            paper.view.update();
            };

            scope.redo = function () {
                if (!redoStack.length)
                    return;
                var redodata = redoStack.pop();
                redoWhiteBoard(redodata);
                undoStack.push(redodata);
                sendUpdate('otWhiteboard_redo', redodata);
            };

            var redoWhiteBoard = function (data) {
                data.visible = true;
                paper.view.update();
            };

            var draw = function (update) {
                window.path.add(update.toX, update.toY);
                drawHistory.push(update);
            };
            
            var drawUpdates = function (updates) {
                updates.forEach(function (update) {
                    draw(update);
                    drawHistory.push(update);
                });
            };
            
            var batchSignal = function (type, data, toConnection) {
                // We send data in small chunks so that they fit in a signal
                // Each packet is maximum ~250 chars, we can fit 8192/250 ~= 32 updates per signal
                var dataCopy = data.slice();
                var signalError = function (err) {
                  if (err) {
                    TB.error(err);
                  }
                };
                while(dataCopy.length) {
                    var dataChunk = dataCopy.splice(0, Math.min(dataCopy.length, 32));
                    var signal = {
                        type: type,
                        data: JSON.stringify(dataChunk)
                    };
                    if (toConnection) signal.to = toConnection;
                    OTSession.session.signal(signal, signalError);
                }
            };
            
            var updateTimeout;
            var sendUpdate = function (type, update) {
                if (OTSession.session) {
                    batchUpdates.push(update);
                    if (!updateTimeout) {
                        updateTimeout = setTimeout(function () {
                            batchSignal(type, batchUpdates);
                            batchUpdates = [];
                            updateTimeout = null;
                        }, 100);
                    }
                }
            };
            
            angular.element(document).on('keyup', function (event) {
                if (event.ctrlKey) {
                    if (event.keyCode === 90)
                        scope.undo();
                    if (event.keyCode === 89)
                        scope.redo();
                }
            });
            
            /*
             *    The Nuts
             *    During the process of drawing, we collect coordinates on every [mouse|touch]move event.
             *    These events occur as fast as the browser can create them, and is computer/browser dependent
             *    
             */

            angular.element(canvas).on('mousedown mousemove mouseup mouseout touchstart touchmove touchend touchcancel',

              function (event) {
                if ((event.type === 'mousemove' || event.type === 'touchmove' || event.type === 'mouseout') && !client.dragging) {
                    // Ignore mouse move Events if we're not dragging
                    return;
                }
                event.preventDefault();
                
                var offset = angular.element(canvas).offset(),
                    scaleX = canvas.width / element.width(),
                    scaleY = canvas.height / element.height(),
                    offsetX = event.offsetX || event.originalEvent.pageX - offset.left ||
                       event.originalEvent.touches[0].pageX - offset.left,
                    offsetY = event.offsetY || event.originalEvent.pageY - offset.top ||
                       event.originalEvent.touches[0].pageY - offset.top,
                    x = offsetX * scaleX,
                    y = offsetY * scaleY,
										mode = !scope.erasing ? "eraser" : "pen",
                    start;
                
                switch (event.type) {
                case 'mousedown':
                case 'touchstart':
                    // Start dragging
                    client.dragging = true;
                    
                    // Where the line
                    client.lastX = x;
                    client.lastY = y;
                    
                    if( window.path ) {
                        window.path.selected = false;
                    }
                    
                    // Create a new path object
                    window.path = new paper.Path();

                    // Apply properties
                    path.strokeColor = scope.color;
                    path.strokeWidth = scope.lineWidth;
                    path.strokeCap = scope.strokeCap;
                    path.strokeJoin = scope.strokeJoin;
                    
                    if(mode=="pen"){
                    	path.blendMode = 'destination-out';
                    }

                    // Move to start and draw a line from there
                    start = new paper.Point(x, y);
                    path.moveTo(start);

                    break;
                case 'mousemove':
                case 'touchmove':
                    offsetX = event.offsetX || event.originalEvent.pageX - offset.left ||
                        event.originalEvent.touches[0].pageX - offset.left,
                    offsetY = event.offsetY || event.originalEvent.pageY - offset.top ||
                        event.originalEvent.touches[0].pageY - offset.top,
                    x = offsetX * scaleX,
                    y = offsetY * scaleY;
                    if (client.dragging) {

                        // Build update object
                        var update = {
                            id: OTSession.session && OTSession.session.connection &&
                                OTSession.session.connection.connectionId,
                            fromX: client.lastX,
                            fromY: client.lastY,
                            toX: x,
                            toY: y,
                            mode: mode,
                            color: scope.color,
                            lineWidth: scope.lineWidth,
                            show: 1
                        };
                        count++;
                        redoStack = [];
                        draw(update);
                        drawHistory.push(update);
                        client.lastX = x;
                        client.lastY = y;
                        sendUpdate('otWhiteboard_update', update);
                    }
                    break;
                case 'touchcancel':
                case 'mouseup':
                case 'touchend':
                case 'mouseout':
                    
                    // Apply smoothing.
                    window.path.smooth();
                    
                    // End dragging.
                    client.dragging = false;
                    if (count) {
                        start = drawHistory.length;
                        undoStack.push(window.path);
                        count = 0;
                    }
                }
            });
            
            if (OTSession.session) {
                OTSession.session.on({
                    'signal:otWhiteboard_update': function (event) {
                        if (event.from.connectionId !== OTSession.session.connection.connectionId) {
                            drawUpdates(JSON.parse(event.data));
                            scope.$emit('otWhiteboardUpdate');
                        }
                    },
                    'signal:otWhiteboard_undo': function (event) {
                        if (event.from.connectionId !== OTSession.session.connection.connectionId) {
                            JSON.parse(event.data).forEach(function (data) {
                                undoWhiteBoard(data);
                            });
                            scope.$emit('otWhiteboardUpdate');
                        }
                    },
                    'signal:otWhiteboard_redo': function (event) {
                        if (event.from.connectionId !== OTSession.session.connection.connectionId) {
                            JSON.parse(event.data).forEach(function (data) {
                                redoWhiteBoard(data);
                            });
                            scope.$emit('otWhiteboardUpdate');
                        }
                    },
                    'signal:otWhiteboard_history': function (event) {
                        // We will receive these from everyone in the room, only listen to the first
                        // person. Also the data is chunked together so we need all of that person's
                        if (!drawHistoryReceivedFrom || drawHistoryReceivedFrom === event.from.connectionId) {
                            drawHistoryReceivedFrom = event.from.connectionId;
                            drawUpdates(JSON.parse(event.data));
                            scope.$emit('otWhiteboardUpdate');
                        }
                    },
                    'signal:otWhiteboard_clear': function (event) {
                        if (event.from.connectionId !== OTSession.session.connection.connectionId) {
                            clearCanvas();
                        }
                    },
                    connectionCreated: function (event) {
                        if (drawHistory.length > 0 && event.connection.connectionId !==
                                OTSession.session.connection.connectionId) {
                            batchSignal('otWhiteboard_history', drawHistory, event.connection);
                        }
                    }
                });
            }
        }
    };
}]);
