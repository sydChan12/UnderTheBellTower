const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
    
    socket.on('createRoom', (name) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[code] = {
            players: [], deck: [], discardPile: [],
            enactedPolicies: { tradition: 0, construction: 0 },
            currentPres: null, currentVP: null, currentVotes: {},
            gameActive: false, presidentialIndex: 0, lastPres: null, lastVP: null
        };
        join(socket, code, name, true);
    });

    socket.on('joinRoom', ({ roomCode, userName }) => {
        const code = roomCode.toUpperCase();
        if (!rooms[code]) return socket.emit('errorMsg', "Room not found.");
        join(socket, code, userName, false);
    });

    function join(socket, code, name, isHost) {
        const room = rooms[code];
        const player = { id: socket.id, name, isHost, alive: true, role: 'Unassigned', party: 'Liberal' };
        room.players.push(player);
        socket.join(code);
        socket.roomCode = code;
        socket.emit('joinedRoom', { roomCode: code, isHost, name });
        io.to(code).emit('updatePlayerList', room.players);
    }

    socket.on('startGame', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.players.length < 5) return socket.emit('errorMsg', "Need 5+ players!");
        
        room.gameActive = true;
        room.deck = [...Array(6).fill("Tradition"), ...Array(11).fill("Construction")].sort(() => 0.5 - Math.random());
        
        // Asymmetric Role Logic
        let shuffled = [...room.players].sort(() => 0.5 - Math.random());
        let bison = shuffled[0];
        bison.role = "THE BISON 🦬"; bison.party = "Fascist";

        // Distribute roles (Delayed slightly to ensure UI is ready)
        setTimeout(() => {
            room.players.forEach(p => {
                if(p.role === 'Unassigned') { p.role = "BOILERMAKER 🚂"; p.party = "Liberal"; }
                io.to(p.id).emit('assignRole', { role: p.role, info: p.party === "Liberal" ? "Protect the Bell Tower!" : "Install the Bison!" });
            });
            io.to(socket.roomCode).emit('gameStarted');
            startNewRound(room);
        }, 500);
    });

    function startNewRound(room) {
        room.currentVotes = {};
        room.currentVP = null;
        room.currentPres = room.players[room.presidentialIndex];
        room.presidentialIndex = (room.presidentialIndex + 1) % room.players.length;
        io.to(socket.roomCode).emit('newRound', { presidentName: room.currentPres.name, presidentId: room.currentPres.id });
    }

    socket.on('nominateVP', (vpName) => {
        const room = rooms[socket.roomCode];
        room.currentVP = room.players.find(p => p.name === vpName);
        io.to(socket.roomCode).emit('startVoting', { pres: room.currentPres.name, vp: vpName });
    });

    socket.on('submitVote', (vote) => {
        const room = rooms[socket.roomCode];
        const p = room.players.find(p => p.id === socket.id);
        room.currentVotes[socket.id] = { name: p.name, choice: vote };

        if (Object.keys(room.currentVotes).length === room.players.filter(pl => pl.alive).length) {
            // Send colored logs
            Object.values(room.currentVotes).forEach(v => {
                const color = v.choice === 'Boiler Up!' ? '#00FF00' : '#FF0000';
                io.to(socket.roomCode).emit('chatMessage', { user: "VOTE", msg: `${v.name}: ${v.choice}`, color: color });
            });

            const yes = Object.values(room.currentVotes).filter(v => v.choice === 'Boiler Up!').length;
            if (yes > (Object.keys(room.currentVotes).length / 2)) {
                io.to(room.currentPres.id).emit('presDrawPhase');
            } else {
                startNewRound(room);
            }
        }
    });

    socket.on('drawThree', () => {
        const room = rooms[socket.roomCode];
        // RESHUFFLE: Only draw/discard piles. Not policies on board.
        if (room.deck.length < 3) {
            room.deck = [...room.deck, ...room.discardPile].sort(() => 0.5 - Math.random());
            room.discardPile = [];
            io.to(socket.roomCode).emit('chatMessage', { user: "SYSTEM", msg: "Deck reshuffled from discard pile." });
        }
        socket.emit('presDiscardPhase', room.deck.splice(0, 3));
    });

    socket.on('presDiscard', (rem) => {
        const room = rooms[socket.roomCode];
        io.to(room.currentVP.id).emit('vpEnactPhase', { cards: rem });
    });

    socket.on('vpEnact', (chosen) => {
        const room = rooms[socket.roomCode];
        chosen === "Tradition" ? room.enactedPolicies.tradition++ : room.enactedPolicies.construction++;
        io.to(socket.roomCode).emit('policyUpdated', { enactedPolicies: room.enactedPolicies });
        startNewRound(room);
    });

    socket.on('sendChat', (msg) => {
        const p = rooms[socket.roomCode]?.players.find(p => p.id === socket.id);
        if (p) io.to(socket.roomCode).emit('chatMessage', { user: p.name, msg });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));