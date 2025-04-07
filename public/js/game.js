// --- Global Variables ---
let socket;
let player = null; // Local player sprite
let otherPlayers = {}; // Sprites of other players { socketId: sprite }
let platforms;
let cursors;
let gameScene; // Reference to the main game scene
let roomCode = null;
let isHost = false;
let currentTaggerId = null;

// --- Phaser Scene ---
class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
    this.playerId = null; // Will be set by socket connection
  }

  preload() {
    // Load simple placeholder assets
    // You can replace these with actual pixel art later
    this.load.image("sky", "https://labs.phaser.io/assets/skies/space3.png"); // Example background
    this.load.image(
      "ground",
      "https://labs.phaser.io/assets/sprites/platform.png"
    ); // Simple platform
    // // Use colored rectangles for players initially
    // this.load.image(
    //   "player_blue",
    //   "https://via.placeholder.com/32x48/0000FF/FFFFFF?text=P"
    // ); // Blue player
    // this.load.image(
    //   "player_red",
    //   "https://via.placeholder.com/32x48/FF0000/FFFFFF?text=T"
    // ); // Red tagger
  }

  create() {
    gameScene = this; // Store reference to this scene

    // --- Generate Player Textures ---
    const playerWidth = 32;
    const playerHeight = 48;
    // Create a temporary Graphics object used for drawing textures
    let graphics = this.add.graphics();

    // --- Draw Blue Player Texture ---
    graphics.fillStyle(0x0000ff, 1); // Set color to blue (hex code), alpha to 1 (fully opaque)
    graphics.fillRect(0, 0, playerWidth, playerHeight); // Draw a rectangle at the top-left of the graphics object
    // Generate a texture named 'player_blue' from the graphics object's current drawing
    graphics.generateTexture("player_blue", playerWidth, playerHeight);
    graphics.clear(); // Clear the graphics object for the next drawing

    // --- Draw Red Player Texture ---
    graphics.fillStyle(0xff0000, 1); // Set color to red
    graphics.fillRect(0, 0, playerWidth, playerHeight); // Draw the rectangle again
    // Generate a texture named 'player_red'
    graphics.generateTexture("player_red", playerWidth, playerHeight);
    graphics.clear(); // Clear the graphics object

    // We don't need the graphics object anymore, so destroy it to free memory
    graphics.destroy();
    // --- End Generate Player Textures ---

    // --- Basic World Setup ---
    this.add.image(400, 300, "sky"); // Add background image (using the key loaded in preload)
    platforms = this.physics.add.staticGroup(); // Create a group for static physics bodies (like platforms)

    // Create some platforms based on the reference image layout (simple version)
    // Ground floor
    platforms.create(400, 568, "ground").setScale(2).refreshBody(); // Main ground platform, scaled up

    // Mid-level platforms
    platforms.create(600, 400, "ground");
    platforms.create(50, 250, "ground");
    platforms.create(750, 220, "ground");

    // Higher platforms
    platforms.create(200, 100, "ground").setScale(0.5).refreshBody(); // Smaller platform
    platforms.create(550, 120, "ground").setScale(0.7).refreshBody(); // Slightly larger small platform

    // --- Player Setup ---
    // Player sprite creation is now handled dynamically when the player joins the room
    // via socket events ('roomCreated' or 'roomJoined' -> 'updatePlayerList' -> 'addPlayer')
    // The textures 'player_blue' and 'player_red' generated above will be used there.

    // --- Controls ---
    cursors = this.input.keyboard.createCursorKeys(); // Setup arrow key controls
    // Add WASD keys for alternative controls
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W); // W for Jump
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A); // A for Left
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D); // D for Right

    // --- Physics ---
    this.physics.world.gravity.y = 600; // Set the global gravity for the arcade physics engine

    // --- Networking Setup ---
    this.setupSockets(); // Call the function to initialize Socket.IO connections and listeners
  } // end create()

  update() {
    if (player && player.active) {
      // Check if local player exists and is active
      const speed = player.isTagger ? 240 : 200; // Tagger moves slightly faster
      const jumpPower = 450; // Adjust jump height

      // --- Player Movement ---
      if (cursors.left.isDown || this.keyA.isDown) {
        player.setVelocityX(-speed);
        // player.anims.play('left', true); // Add animation later
        player.setFlipX(true); // Face left
      } else if (cursors.right.isDown || this.keyD.isDown) {
        player.setVelocityX(speed);
        // player.anims.play('right', true); // Add animation later
        player.setFlipX(false); // Face right
      } else {
        player.setVelocityX(0);
        // player.anims.play('turn'); // Add animation later
      }

      // --- Player Jumping ---
      const canJump = player.body.touching.down; // Only jump if on ground
      if (
        (cursors.up.isDown || this.keyW.isDown || cursors.space.isDown) &&
        canJump
      ) {
        player.setVelocityY(-jumpPower);
      }

      // --- Emit Movement ---
      // Send updates periodically or on significant change
      // Basic version: send if position changed
      if (
        player.oldPosition &&
        (player.x !== player.oldPosition.x ||
          player.y !== player.oldPosition.y ||
          player.flipX !== player.oldPosition.flipX)
      ) {
        socket.emit("playerMovement", {
          x: player.x,
          y: player.y,
          velocityX: player.body.velocity.x,
          velocityY: player.body.velocity.y,
          flipX: player.flipX, // Send facing direction
        });
      }

      // Store previous position for comparison
      player.oldPosition = { x: player.x, y: player.y, flipX: player.flipX };
    }

    // --- Update Other Players (Basic Interpolation/Setting) ---
    for (const id in otherPlayers) {
      const target = otherPlayers[id].targetPosition;
      const sprite = otherPlayers[id].sprite;
      if (target && sprite) {
        // Directly set position (no smoothing yet)
        sprite.x = target.x;
        sprite.y = target.y;
        sprite.setFlipX(target.flipX); // Update facing direction

        // Optional: crude velocity simulation if needed for animations/effects
        // sprite.setVelocity(target.velocityX || 0, target.velocityY || 0);
      }
    }
  } // end update()

  // --- Socket Handling Methods ---
  setupSockets() {
    socket = io(); // Connect to the server
    this.playerId = socket.id; // Assign socket id on connect event

    socket.on("connect", () => {
      console.log("Connected to server!", socket.id);
      this.playerId = socket.id; // Ensure player ID is set
      // Now safe to potentially create player or wait for room join confirmation
    });

    socket.on("disconnect", (reason) => {
      console.log("Disconnected from server:", reason);
      // Handle disconnection - maybe show a message, disable input
      if (player) player.destroy();
      Object.values(otherPlayers).forEach((p) => p.sprite.destroy());
      otherPlayers = {};
      player = null;
      resetUI(); // Reset UI elements
    });

    socket.on("roomCreated", (data) => {
      console.log("Room Created:", data);
      roomCode = data.roomCode;
      isHost = true;
      updateRoomUI(data.roomCode, Object.keys(data.players).length, true);
      document.getElementById("startGameBtn").style.display = "inline-block"; // Show start button for host

      // Create the host player's sprite
      this.addPlayer(data.players[this.playerId]);
      // Add existing players (should only be the host at this point)
      this.updatePlayerList(data.players);
    });

    socket.on("roomJoined", (data) => {
      console.log("Joined Room:", data);
      roomCode = data.roomCode;
      isHost = data.hostId === this.playerId;
      currentTaggerId = data.taggerId;
      updateRoomUI(data.roomCode, Object.keys(data.players).length, isHost);
      if (isHost && !data.gameStarted) {
        document.getElementById("startGameBtn").style.display = "inline-block";
      } else {
        document.getElementById("startGameBtn").style.display = "none";
      }

      // Add all players currently in the room
      this.updatePlayerList(data.players);

      // If game already started, update timer display etc.
      if (data.gameStarted) {
        console.log("Joining a game already in progress");
        // Request current timer state or rely on next update
      }
    });

    socket.on("playerJoined", (playerInfo) => {
      console.log("Another player joined:", playerInfo);
      if (playerInfo.id !== this.playerId) {
        // Don't add self again
        this.addOtherPlayer(playerInfo);
        updateRoomUI(
          roomCode,
          Object.keys(otherPlayers).length + (player ? 1 : 0),
          isHost
        ); // Update count
      }
    });

    socket.on("playerLeft", (playerId) => {
      console.log("Player left:", playerId);
      if (otherPlayers[playerId]) {
        otherPlayers[playerId].sprite.destroy();
        delete otherPlayers[playerId];
        updateRoomUI(
          roomCode,
          Object.keys(otherPlayers).length + (player ? 1 : 0),
          isHost
        ); // Update count
      }
    });

    socket.on("newHost", (newHostId) => {
      console.log("New host is:", newHostId);
      isHost = newHostId === this.playerId;
      updateRoomUI(
        roomCode,
        Object.keys(otherPlayers).length + (player ? 1 : 0),
        isHost
      );
      // Show/hide start button based on new host status and game state (add check for gameStarted later)
      const gameRunning =
        document.getElementById("timer").textContent !== "Time: --"; // Simple check
      if (isHost && !gameRunning) {
        document.getElementById("startGameBtn").style.display = "inline-block";
      } else {
        document.getElementById("startGameBtn").style.display = "none";
      }
    });

    socket.on("gameStarted", (data) => {
      console.log("Game Started! Tagger is:", data.taggerId);
      currentTaggerId = data.taggerId;
      this.updateTaggerVisuals();
      document.getElementById("startGameBtn").style.display = "none"; // Hide start button
      document.getElementById("timer").textContent = `Time: ${data.duration}`; // Show initial time
    });

    socket.on("timerUpdate", (timeRemaining) => {
      document.getElementById("timer").textContent = `Time: ${timeRemaining}`;
    });

    socket.on("gameOver", (data) => {
      console.log("Game Over!", data ? data.reason || "" : "");
      alert("Game Over! " + (data ? data.reason || "" : "")); // Simple alert
      currentTaggerId = null; // Reset tagger
      this.updateTaggerVisuals(); // Make everyone non-tagger color
      document.getElementById("timer").textContent = "Time: --";
      resetUI(); // Reset most UI elements
      // Could add a "Return to Lobby" button or similar here
    });

    socket.on("playerMoved", (playerData) => {
      if (otherPlayers[playerData.id]) {
        // Store the target state for interpolation/setting in update()
        otherPlayers[playerData.id].targetPosition = {
          x: playerData.x,
          y: playerData.y,
          velocityX: playerData.velocityX,
          velocityY: playerData.velocityY,
          flipX: playerData.flipX,
        };
      } else {
        // Player might not exist yet locally, maybe add them?
        console.warn(`Received move for unknown player: ${playerData.id}`);
        // You might need to request full player list or handle this case
      }
    });

    socket.on("newTagger", (data) => {
      console.log(
        `New tagger is ${data.newTaggerId}, previous was ${data.oldTaggerId}`
      );
      currentTaggerId = data.newTaggerId;
      this.updateTaggerVisuals();
    });

    socket.on("errorJoining", (message) => {
      console.error("Error joining room:", message);
      alert(`Failed to join room: ${message}`); // Show error to user
    });

    socket.on("updatePlayerList", (allPlayers) => {
      console.log("Received full player list update", allPlayers);
      this.updatePlayerList(allPlayers);
    });
  } // end setupSockets()

  // --- Player Management Methods ---

  updatePlayerList(playersData) {
    // Remove players that are no longer in the list
    for (const id in otherPlayers) {
      if (!playersData[id]) {
        otherPlayers[id].sprite.destroy();
        delete otherPlayers[id];
      }
    }
    // Add or update players
    for (const id in playersData) {
      const pData = playersData[id];
      if (id === this.playerId) {
        if (!player) {
          // If local player doesn't exist yet, create it
          this.addPlayer(pData);
        } else {
          // Update existing local player data if necessary (e.g., tagger status)
          player.isTagger = pData.isTagger;
          player.setPosition(pData.x, pData.y); // Sync position initially
        }
      } else {
        if (!otherPlayers[id]) {
          // If other player doesn't exist, create it
          this.addOtherPlayer(pData);
        } else {
          // Update existing other player data
          otherPlayers[id].sprite.setPosition(pData.x, pData.y); // Sync position
          otherPlayers[id].sprite.isTagger = pData.isTagger; // Update tagger status for visuals
        }
      }
    }
    this.updateTaggerVisuals(); // Ensure visuals are correct after update
    updateRoomUI(roomCode, Object.keys(playersData).length, isHost); // Update count
  }

  addPlayer(playerInfo) {
    if (player) player.destroy(); // Remove old sprite if exists

    const texture = playerInfo.isTagger ? "player_red" : "player_blue";
    player = this.physics.add.sprite(playerInfo.x, playerInfo.y, texture);

    // --- Add this line ---
    player.body.enable = true; // Explicitly ensure the physics body is active

    player.setBounce(0.1); // Slight bounce
    player.setCollideWorldBounds(true); // Keep player within game bounds
    player.isTagger = playerInfo.isTagger; // Custom property
    player.playerId = playerInfo.id; // Store id

    // Add collision with platforms
    this.physics.add.collider(player, platforms);

    // Setup overlap check between local player and others
    // Note: We only need to check if the *local* player (if tagger) overlaps others
    // Rebuild overlap if other players already exist
    const otherSprites = Object.values(otherPlayers).map((p) => p.sprite);
    if (otherSprites.length > 0) {
      this.physics.add.overlap(
        player,
        otherSprites, // Pass the array of sprites
        this.checkTag,
        null,
        this
      );
    }

    console.log(
      "Local player created:",
      player.playerId,
      "Body enabled:",
      player.body.enable
    ); // Added log
    this.updateTaggerVisuals();
  }

  addOtherPlayer(playerInfo) {
    if (otherPlayers[playerInfo.id]) return; // Already exists
    if (playerInfo.id === this.playerId) return; // Should not add self here

    const texture = playerInfo.isTagger ? "player_red" : "player_blue";
    const otherSprite = this.physics.add.sprite(
      playerInfo.x,
      playerInfo.y,
      texture
    );
    otherSprite.setCollideWorldBounds(true);
    otherSprite.body.setAllowGravity(false); // Gravity/physics is controlled by their client
    otherSprite.body.enable = true; // Also ensure other bodies are enabled (for collision detection)
    otherSprite.playerId = playerInfo.id; // Store id
    otherSprite.isTagger = playerInfo.isTagger; // Store tagger status

    otherPlayers[playerInfo.id] = {
      sprite: otherSprite,
      targetPosition: {
        /* ... */
      },
    };

    // Add collision between other players and platforms (optional, prevents visual glitches)
    this.physics.add.collider(otherSprite, platforms);

    // Add overlap check IF the local player sprite exists
    // This allows the local player to tag this other player
    if (player) {
      this.physics.add.overlap(player, otherSprite, this.checkTag, null, this);
    }

    console.log("Other player added:", playerInfo.id);
    this.updateTaggerVisuals();
  }

  updateTaggerVisuals() {
    // Update local player
    if (player) {
      // Check if the local player is the current tagger
      const isCurrentlyTagger = player.playerId === currentTaggerId;
      player.isTagger = isCurrentlyTagger; // Keep track of the status

      // Determine the correct texture key
      const newTexture = isCurrentlyTagger ? "player_red" : "player_blue";

      // Only update the texture if it's different from the current one
      if (player.texture.key !== newTexture) {
        player.setTexture(newTexture); // Set to red or blue texture
      }

      // Clear any previous tint to rely purely on the texture's color
      player.clearTint();

      // --- Alternatively, if you WANT a solid red tint instead of using player_red texture ---
      // if(isCurrentlyTagger) {
      //     player.setTexture('player_blue'); // Use a base texture
      //     player.setTint(0xff0000); // Apply solid red tint
      // } else {
      //     player.setTexture('player_blue');
      //     player.clearTint();
      // }
      // --- End Alternative ---
    }

    // Update other players
    for (const id in otherPlayers) {
      const p = otherPlayers[id].sprite;
      if (!p || !p.body) continue; // Skip if sprite or body doesn't exist

      // Check if this 'other' player is the current tagger
      const isCurrentlyTagger = p.playerId === currentTaggerId;
      p.isTagger = isCurrentlyTagger;

      // Determine the correct texture key
      const newTexture = isCurrentlyTagger ? "player_red" : "player_blue";

      // Only update the texture if it's different
      if (p.texture.key !== newTexture) {
        p.setTexture(newTexture); // Set to red or blue texture
      }

      // Clear any previous tint
      p.clearTint();

      // --- Alternative Tint Logic (match local player choice) ---
      // if(isCurrentlyTagger) {
      //     p.setTexture('player_blue');
      //     p.setTint(0xff0000);
      // } else {
      //     p.setTexture('player_blue');
      //     p.clearTint();
      // }
      // --- End Alternative ---
    }
  }

  // --- Collision Handling ---
  checkTag(playerSprite, otherPlayerSprite) {
    // This function is called when the local player sprite overlaps ANY other sprite

    // Only proceed if the local player is the current tagger AND the game is running
    if (
      playerSprite.isTagger &&
      currentTaggerId === playerSprite.playerId &&
      document.getElementById("timer").textContent !== "Time: --"
    ) {
      console.log(
        `Local tagger ${playerSprite.playerId} touched ${otherPlayerSprite.playerId}`
      );
      // Prevent self-tagging or tagging non-players
      if (
        otherPlayerSprite.playerId &&
        playerSprite.playerId !== otherPlayerSprite.playerId
      ) {
        // Tell the server that a tag occurred
        socket.emit("tagPlayer", otherPlayerSprite.playerId);
        // Optional: Add a small cooldown locally to prevent instant re-tag
      }
    }
  }
} // end GameScene

// --- Phaser Game Configuration ---
const config = {
  type: Phaser.AUTO, // Use WebGL if available, otherwise Canvas
  parent: "game-container", // ID of the div to contain the game
  width: 800,
  height: 600,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 600 }, // Set globally if preferred
      debug: false, // Set to true for physics debugging visuals
    },
  },
  scene: [GameScene], // Add more scenes here later (e.g., MainMenu, UIScene)
};

// --- UI Event Listeners ---
window.onload = () => {
  const game = new Phaser.Game(config); // Initialize Phaser

  const joinRoomBtn = document.getElementById("joinRoomBtn");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const roomCodeInput = document.getElementById("roomCodeInput");
  const startGameBtn = document.getElementById("startGameBtn");

  createRoomBtn.addEventListener("click", () => {
    if (socket && socket.connected) {
      // Optional: Allow setting timer duration here
      socket.emit("createRoom", { timer: 120 }); // Default 120s for now
      disableRoomButtons();
    } else {
      alert("Not connected to server!");
    }
  });

  joinRoomBtn.addEventListener("click", () => {
    const code = roomCodeInput.value.trim();
    if (socket && socket.connected && code) {
      socket.emit("joinRoom", code);
      disableRoomButtons();
    } else if (!code) {
      alert("Please enter a room code.");
    } else {
      alert("Not connected to server!");
    }
  });

  startGameBtn.addEventListener("click", () => {
    if (socket && socket.connected && roomCode && isHost) {
      socket.emit("startGame");
    } else {
      alert("Cannot start game. Not connected, not host, or not in a room.");
    }
  });
};

function updateRoomUI(code, count, hostStatus) {
  document.getElementById("roomCodeDisplay").textContent = code || "N/A";
  document.getElementById("playerCount").textContent = count || 0;
  document.getElementById("isHost").textContent = hostStatus ? "Yes" : "No";
  if (code) disableRoomButtons(); // Disable create/join once in a room
}

function disableRoomButtons() {
  document.getElementById("joinRoomBtn").disabled = true;
  document.getElementById("createRoomBtn").disabled = true;
  document.getElementById("roomCodeInput").disabled = true;
}

function resetUI() {
  document.getElementById("joinRoomBtn").disabled = false;
  document.getElementById("createRoomBtn").disabled = false;
  document.getElementById("roomCodeInput").disabled = false;
  document.getElementById("roomCodeInput").value = "";
  document.getElementById("startGameBtn").style.display = "none";
  document.getElementById("roomCodeDisplay").textContent = "N/A";
  document.getElementById("playerCount").textContent = "0";
  document.getElementById("isHost").textContent = "No";
  document.getElementById("timer").textContent = "Time: --";
  roomCode = null;
  isHost = false;
  currentTaggerId = null;
}
