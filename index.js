const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Add cors configuration to allow connections from any origin during development
const io = socketIO(server, {
    cors: {
        origin: "*", // Allow all origins
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

let rooms = {}; // Stores room data { roomCode: { players: {}, hostId: null, settings: {}, taggerId: null, timer: null, intervalId: null } }
let playerRooms = {}; // Stores which room each player is in { socketId: roomCode }

function generateRoomCode() {
    // Simple 4-digit code generator
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]); // Ensure code is unique
    return code;
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // --- Room Management ---
    socket.on('createRoom', (settings = { timer: 120 }) => { // Default timer 120s
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            players: {},
            hostId: socket.id,
            settings: settings,
            taggerId: null,
            timer: settings.timer, // Initialize timer
            intervalId: null,    // To clear interval later
            gameStarted: false
        };
        // Add player to room
        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            x: 400, // Starting position (adjust as needed)
            y: 300,
            isTagger: false
        };
        playerRooms[socket.id] = roomCode;
        socket.join(roomCode);
        console.log(`Room created: ${roomCode} by ${socket.id}`);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players, hostId: socket.id, settings: rooms[roomCode].settings });
    });

    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode]) {
            if (Object.keys(rooms[roomCode].players).length < 6) { // Limit players
                // Add player to room
                rooms[roomCode].players[socket.id] = {
                    id: socket.id,
                    x: 400, // Starting position
                    y: 300,
                    isTagger: false
                };
                playerRooms[socket.id] = roomCode;
                socket.join(roomCode);
                console.log(`${socket.id} joined room: ${roomCode}`);

                // Notify the new player about the current room state
                socket.emit('roomJoined', {
                    roomCode,
                    players: rooms[roomCode].players,
                    hostId: rooms[roomCode].hostId,
                    settings: rooms[roomCode].settings,
                    taggerId: rooms[roomCode].taggerId,
                    gameStarted: rooms[roomCode].gameStarted
                 });

                // Notify existing players in the room about the new player
                socket.to(roomCode).emit('playerJoined', rooms[roomCode].players[socket.id]);

            } else {
                socket.emit('errorJoining', 'Room is full.');
                console.log(`Join failed: Room ${roomCode} is full.`);
            }
        } else {
            socket.emit('errorJoining', 'Room not found.');
            console.log(`Join failed: Room ${roomCode} not found.`);
        }
    });

    // --- Game Logic ---
    socket.on('startGame', () => {
        const roomCode = playerRooms[socket.id];
        if (rooms[roomCode] && rooms[roomCode].hostId === socket.id && !rooms[roomCode].gameStarted) {
            const room = rooms[roomCode];
            room.gameStarted = true;
            room.timer = room.settings.timer; // Reset timer

             // Select initial tagger randomly
            const playerIds = Object.keys(room.players);
            if (playerIds.length > 0) {
                const randomIndex = Math.floor(Math.random() * playerIds.length);
                room.taggerId = playerIds[randomIndex];
                room.players[room.taggerId].isTagger = true;
                 console.log(`Game starting in room ${roomCode}. Tagger: ${room.taggerId}`);
            } else {
                 console.log(`Game cannot start in room ${roomCode}. No players.`);
                 // Ideally, send an error back to the host
                 room.gameStarted = false; // Revert state
                 return;
            }


            // Notify all players in the room that the game has started
            io.to(roomCode).emit('gameStarted', { taggerId: room.taggerId, startTime: Date.now(), duration: room.timer });

            // Start server-side timer (Example - replace with more robust timer logic)
            if (room.intervalId) clearInterval(room.intervalId); // Clear existing timer if any
            room.intervalId = setInterval(() => {
                if (room.timer > 0) {
                    room.timer--;
                    io.to(roomCode).emit('timerUpdate', room.timer); // Send timer updates
                } else {
                    // Game Over
                    clearInterval(room.intervalId);
                    room.intervalId = null;
                    room.gameStarted = false; // Reset game state
                    room.taggerId = null; // Reset tagger
                     // Reset player tagger status
                    Object.values(room.players).forEach(p => p.isTagger = false);
                    io.to(roomCode).emit('gameOver');
                    console.log(`Game ended in room ${roomCode}`);
                     // Optionally: Clean up room or prepare for restart
                }
            }, 1000);

        } else {
             console.log(`Start game failed for room ${roomCode}. Not host or game already started.`);
             // Optionally emit an error message back to the requester
        }
    });


    socket.on('playerMovement', (movementData) => {
        const roomCode = playerRooms[socket.id];
        if (rooms[roomCode] && rooms[roomCode].players[socket.id]) {
            // Update server state
            rooms[roomCode].players[socket.id].x = movementData.x;
            rooms[roomCode].players[socket.id].y = movementData.y;
            rooms[roomCode].players[socket.id].velocityX = movementData.velocityX; // Store velocity too
            rooms[roomCode].players[socket.id].velocityY = movementData.velocityY;
            rooms[roomCode].players[socket.id].flipX = movementData.flipX; // Store facing direction


            // Broadcast movement to other players in the same room
            socket.to(roomCode).emit('playerMoved', {
                id: socket.id,
                x: movementData.x,
                y: movementData.y,
                velocityX: movementData.velocityX,
                velocityY: movementData.velocityY,
                flipX: movementData.flipX
            });
        }
    });

    socket.on('tagPlayer', (taggedPlayerId) => {
        const roomCode = playerRooms[socket.id];
        const room = rooms[roomCode];

        // Validate: Only the current tagger can tag, and game must be running
        if (room && room.gameStarted && room.taggerId === socket.id && room.players[taggedPlayerId]) {
            console.log(`Tag attempt: ${socket.id} tagged ${taggedPlayerId} in room ${roomCode}`);

             // Update tagger status on server
            if(room.players[room.taggerId]) {
                room.players[room.taggerId].isTagger = false;
            }
            room.players[taggedPlayerId].isTagger = true;
            room.taggerId = taggedPlayerId;

            // Broadcast the new tagger to everyone in the room
            io.to(roomCode).emit('newTagger', { newTaggerId: taggedPlayerId, oldTaggerId: socket.id });
            console.log(`New tagger in room ${roomCode}: ${taggedPlayerId}`);
        } else {
             console.log(`Invalid tag attempt by ${socket.id} in room ${roomCode}`);
        }
    });


    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        const roomCode = playerRooms[socket.id];
        if (roomCode && rooms[roomCode]) {
            const room = rooms[roomCode];
            console.log(`Removing ${socket.id} from room ${roomCode}`);

             // Remove player from room
            delete room.players[socket.id];
            delete playerRooms[socket.id];

             // Notify remaining players
            io.to(roomCode).emit('playerLeft', socket.id);

             // Handle host leaving
            if (room.hostId === socket.id) {
                const playerIds = Object.keys(room.players);
                if (playerIds.length > 0) {
                    // Assign a new host (e.g., the first player remaining)
                    room.hostId = playerIds[0];
                    console.log(`Host left room ${roomCode}. New host: ${room.hostId}`);
                    // Notify everyone about the new host
                    io.to(roomCode).emit('newHost', room.hostId);
                } else {
                    // Room is empty, delete it
                    console.log(`Room ${roomCode} is empty. Deleting.`);
                    if (room.intervalId) clearInterval(room.intervalId); // Stop timer if running
                    delete rooms[roomCode];
                }
            }

            // Optional: End game if fewer than 2 players remain
            if (room.gameStarted && Object.keys(room.players).length < 2) {
                console.log(`Ending game in room ${roomCode} due to insufficient players.`);
                 if (room.intervalId) clearInterval(room.intervalId);
                 room.intervalId = null;
                 room.gameStarted = false;
                 room.taggerId = null;
                 Object.values(room.players).forEach(p => p.isTagger = false);
                 io.to(roomCode).emit('gameOver', { reason: 'Not enough players' }); // Send game over
                 // Consider deleting the room or resetting it
            }

        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on *:${PORT}`);
});