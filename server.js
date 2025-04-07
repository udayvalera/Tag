// server.js
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
// Add cors configuration to allow connections from any origin during development
const io = socketIO(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
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

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // --- Room Management ---
  socket.on("createRoom", (settings = { timer: 120 }) => {
    // Default timer 120s
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: {},
      hostId: socket.id,
      settings: settings,
      taggerId: null,
      timer: settings.timer, // Initialize timer
      intervalId: null, // To clear interval later
      gameStarted: false,
    };
    // Add player to room
    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      x: 400, // Starting position (adjust as needed)
      y: 300,
      isTagger: false,
    };
    playerRooms[socket.id] = roomCode;
    socket.join(roomCode);
    console.log(`Room created: ${roomCode} by ${socket.id}`);
    socket.emit("roomCreated", {
      roomCode,
      players: rooms[roomCode].players,
      hostId: socket.id,
      settings: rooms[roomCode].settings,
    });
  });

  socket.on("joinRoom", (roomCode) => {
    if (rooms[roomCode]) {
      if (Object.keys(rooms[roomCode].players).length < 6) {
        // Limit players
        // Add player to room
        rooms[roomCode].players[socket.id] = {
          id: socket.id,
          x: 400, // Starting position
          y: 300,
          isTagger: false,
        };
        playerRooms[socket.id] = roomCode;
        socket.join(roomCode);
        console.log(`${socket.id} joined room: ${roomCode}`);

        // Notify the new player about the current room state
        socket.emit("roomJoined", {
          roomCode,
          players: rooms[roomCode].players,
          hostId: rooms[roomCode].hostId,
          settings: rooms[roomCode].settings,
          taggerId: rooms[roomCode].taggerId,
          gameStarted: rooms[roomCode].gameStarted,
        });

        // Notify existing players in the room about the new player
        socket
          .to(roomCode)
          .emit("playerJoined", rooms[roomCode].players[socket.id]);
      } else {
        socket.emit("errorJoining", "Room is full.");
        console.log(`Join failed: Room ${roomCode} is full.`);
      }
    } else {
      socket.emit("errorJoining", "Room not found.");
      console.log(`Join failed: Room ${roomCode} not found.`);
    }
  });

  // --- Game Logic ---
  socket.on("startGame", () => {
    const roomCode = playerRooms[socket.id];
    // Basic validation: is the requester the host? Is game not already started?
    if (
      rooms[roomCode] &&
      rooms[roomCode].hostId === socket.id &&
      !rooms[roomCode].gameStarted
    ) {
      const room = rooms[roomCode];
      room.gameStarted = true;
      room.timer = room.settings.timer; // Reset timer to initial duration

      // --- Tagger Selection Logic ---
      const playerIds = Object.keys(room.players); // Get all player IDs in the room

      // Ensure there are players to select from
      if (playerIds.length > 0) {
        // (You might want playerIds.length >= 2 for a proper game)

        // Explicitly reset everyone's tagger status (good practice)
        playerIds.forEach((id) => {
          if (room.players[id]) {
            // Check player still exists
            room.players[id].isTagger = false;
          }
        });

        // Select a random index
        const randomIndex = Math.floor(Math.random() * playerIds.length);
        // Get the ID of the player at that random index
        room.taggerId = playerIds[randomIndex];

        // Update the selected player's status on the server
        if (room.players[room.taggerId]) {
          // Ensure player didn't disconnect right at this moment
          room.players[room.taggerId].isTagger = true;
          console.log(
            `Game starting in room ${roomCode}. Tagger: ${room.taggerId}`
          );
        } else {
          // Handle rare edge case where the randomly selected player disconnected just now
          console.error(
            `Selected tagger ${room.taggerId} disconnected during game start in room ${roomCode}.`
          );
          room.gameStarted = false; // Cancel start
          // Optional: Send an error message back to the host
          socket.emit("gameStartFailed", "Selected tagger disconnected.");
          return; // Stop the start process
        }
      } else {
        // Not enough players to start
        console.log(`Game cannot start in room ${roomCode}. No players.`);
        room.gameStarted = false; // Revert state
        // Optional: Send an error message back to the host
        socket.emit("gameStartFailed", "Not enough players to start.");
        return; // Stop the start process
      }
      // --- End Tagger Selection Logic ---

      // Notify all players in the room that the game has started
      // Crucially, send the ID of the chosen tagger
      io.to(roomCode).emit("gameStarted", {
        taggerId: room.taggerId, // <<< This sends the tagger ID to all clients
        startTime: Date.now(),
        duration: room.timer,
      });

      // --- Start server-side timer ---
      if (room.intervalId) clearInterval(room.intervalId); // Clear existing timer if any
      room.intervalId = setInterval(() => {
        // (Timer logic remains the same)
        // ...
      }, 1000);
    } else {
      // Log if the start request was invalid
      console.log(
        `Start game failed for room ${roomCode}. Not host or game already started.`
      );
      // Optionally emit an error message back to the requester
      socket.emit(
        "gameStartFailed",
        "Only the host can start the game, or game already running."
      );
    }
  });

  socket.on("playerMovement", (movementData) => {
    const roomCode = playerRooms[socket.id];
    if (rooms[roomCode] && rooms[roomCode].players[socket.id]) {
      // Update server state
      rooms[roomCode].players[socket.id].x = movementData.x;
      rooms[roomCode].players[socket.id].y = movementData.y;
      rooms[roomCode].players[socket.id].velocityX = movementData.velocityX; // Store velocity too
      rooms[roomCode].players[socket.id].velocityY = movementData.velocityY;
      rooms[roomCode].players[socket.id].flipX = movementData.flipX; // Store facing direction

      // Broadcast movement to other players in the same room
      socket.to(roomCode).emit("playerMoved", {
        id: socket.id,
        x: movementData.x,
        y: movementData.y,
        velocityX: movementData.velocityX,
        velocityY: movementData.velocityY,
        flipX: movementData.flipX,
      });
    }
  });

  socket.on("tagPlayer", (taggedPlayerId) => {
    const roomCode = playerRooms[socket.id];
    console.log(
      `[${roomCode || "No Room"}] Received 'tagPlayer' event from ${
        socket.id
      } targeting ${taggedPlayerId}`
    );

    const room = rooms[roomCode];
    const taggerPlayer = room ? room.players[socket.id] : null; // The player attempting the tag
    const taggedPlayer = room ? room.players[taggedPlayerId] : null; // The player being targeted
    const now = Date.now();

    // --- Set Immunity Duration ---
    const immunityDuration = 500; // <--- CHANGED TO 500ms (0.5 seconds)
    // ---

    // --- Pre-Tag Validation ---
    if (!room || !room.gameStarted) {
      console.log(`[${roomCode}] Tag ignored: Game not running.`);
      return;
    }
    if (!taggerPlayer || room.taggerId !== socket.id) {
      console.log(
        `[${roomCode}] Tag ignored: Sender ${socket.id} is not the tagger (expected ${room.taggerId}).`
      );
      return;
    }
    if (!taggedPlayer) {
      console.log(
        `[${roomCode}] Tag ignored: Tagged player ${taggedPlayerId} not found.`
      );
      return;
    }
    // Check if the player attempting the tag is immune
    if (taggerPlayer.immuneUntil > now) {
      console.log(
        `[${roomCode}] Tag ignored: Tagger ${socket.id} is currently immune (until ${taggerPlayer.immuneUntil}).`
      );
      return;
    }
    if (socket.id === taggedPlayerId) {
      console.log(
        `[${roomCode}] Tag ignored: Player ${socket.id} tried to self-tag.`
      );
      return;
    }
    // --- End Validation ---

    // --- Process Valid Tag ---
    console.log(
      `[${roomCode}] Tag Processed: ${socket.id} tagged ${taggedPlayerId}`
    );

    // Update tagger status on server
    taggerPlayer.isTagger = false;
    taggedPlayer.isTagger = true; // New tagger

    // Grant immunity TO THE NEWLY TAGGED PLAYER
    taggedPlayer.immuneUntil = now + immunityDuration; // Use the 500ms duration
    console.log(
      `[${roomCode}] Player ${taggedPlayerId} is now the tagger and is immune until ${taggedPlayer.immuneUntil}`
    );

    // Update the room's official tagger ID
    room.taggerId = taggedPlayerId;

    // Broadcast the new tagger to everyone in the room
    io.to(roomCode).emit("newTagger", {
      newTaggerId: taggedPlayerId,
      oldTaggerId: socket.id,
    });
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    const roomCode = playerRooms[socket.id];
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      console.log(`Removing ${socket.id} from room ${roomCode}`);

      // Remove player from room
      delete room.players[socket.id];
      delete playerRooms[socket.id];

      // Notify remaining players
      io.to(roomCode).emit("playerLeft", socket.id);

      // Handle host leaving
      if (room.hostId === socket.id) {
        const playerIds = Object.keys(room.players);
        if (playerIds.length > 0) {
          // Assign a new host (e.g., the first player remaining)
          room.hostId = playerIds[0];
          console.log(`Host left room ${roomCode}. New host: ${room.hostId}`);
          // Notify everyone about the new host
          io.to(roomCode).emit("newHost", room.hostId);
        } else {
          // Room is empty, delete it
          console.log(`Room ${roomCode} is empty. Deleting.`);
          if (room.intervalId) clearInterval(room.intervalId); // Stop timer if running
          delete rooms[roomCode];
        }
      }

      // Optional: End game if fewer than 2 players remain
      if (room.gameStarted && Object.keys(room.players).length < 2) {
        console.log(
          `Ending game in room ${roomCode} due to insufficient players.`
        );
        if (room.intervalId) clearInterval(room.intervalId);
        room.intervalId = null;
        room.gameStarted = false;
        room.taggerId = null;
        Object.values(room.players).forEach((p) => (p.isTagger = false));
        io.to(roomCode).emit("gameOver", { reason: "Not enough players" }); // Send game over
        // Consider deleting the room or resetting it
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
