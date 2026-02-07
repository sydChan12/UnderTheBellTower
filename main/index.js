const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let players = []; // Like an ArrayList<Player>

// This tells the server: "When someone visits the home page (/), send index.html"
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// This runs whenever a "client" (phone/tab) connects
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // When someone joins the lobby
    socket.on('joinGame', (name) => {
        const newPlayer = { id: socket.id, name: name, role: 'Unassigned' };
        players.push(newPlayer);
        
        // Tell EVERYONE the new player list (Broadcast)
        io.emit('updatePlayerList', players);
    });
    // Listen for the "Start Game" signal
    socket.on('startGame', () => {
        if (players.length < 2) return; // Need at least 2 to play!

        // 1. Shuffle players (Standard Fisher-Yates shuffle logic)
        let shuffled = [...players].sort(() => 0.5 - Math.random());

        // 2. Assign Roles
        // For simplicity: First person in shuffled list is the Spy
        const spyId = shuffled[0].id;

        players.forEach(p => {
            if (p.id === spyId) {
                p.role = "IU SPY 🚩";
                // Send a PRIVATE message to just this player
                io.to(p.id).emit('assignRole', "You are the IU SPY. Sabotage the Boilers!");
            } else {
                p.role = "BOILERMAKER 🚂";
                io.to(p.id).emit('assignRole', "You are a BOILERMAKER. Protect the traditions!");
            }
        });

        // 3. Notify everyone that the game has started
        io.emit('gameStarted');
    });

    // Handle disconnection (like a close() call)
    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

server.listen(3000, () => {
    console.log('Server is UP at http://localhost:3000');
});
