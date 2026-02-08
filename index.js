const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
    socket.on('createRoom', (userName) => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomCode] = {
            players: [], deck: [], discardPile: [],
            enactedPolicies: { tradition: 0, construction: 0 },
            electionTracker: 0, lastPresident: null, lastVP: null,
            currentPres: null, currentVP: null, currentVotes: {},
            gameActive: false, presidentialIndex: 0
        };
        joinPlayerToRoom(socket, roomCode, userName, true);
    });

    socket.on('joinRoom', ({ roomCode, userName }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];
        if (!room) return socket.emit('errorMsg', "Room not found.");
        joinPlayerToRoom(socket, code, userName, false);
    });

    function joinPlayerToRoom(socket, roomCode, name, isHost) {
        const room = rooms[roomCode];
        const newPlayer = { id: socket.id, name, isHost, alive: true, role: 'Unassigned', party: 'Boilermaker' };
        room.players.push(newPlayer);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.emit('joinedRoom', { roomCode, isHost, name });
        io.to(roomCode).emit('updatePlayerList', getPlayerListWithStatus(room));
    }

    socket.on('startGame', () => {
        const room = rooms[socket.roomCode];
        if (!room || room.players.length < 5) return socket.emit('errorMsg', "Need 5+ players.");
        room.gameActive = true;
        // 11 Hoosier cards, 6 Boilermaker cards
        room.deck = [...Array(6).fill("Boilermaker"), ...Array(11).fill("Hoosier")].sort(() => 0.5 - Math.random());
        
        let shuffled = [...room.players].sort(() => 0.5 - Math.random());
        let bison = shuffled[0];
        bison.role = "THE BISON 🦬"; bison.party = "Hoosier";

        let spyCount = room.players.length <= 6 ? 1 : room.players.length <= 8 ? 2 : 3;
        let spies = shuffled.slice(1, 1 + spyCount);
        spies.forEach(s => { 
            s.role = "HOOSIER SPY 🚩"; s.party = "Hoosier"; 
            io.to(s.id).emit('assignRole', { role: s.role, info: `The Bison is: ${bison.name}` });
        });

        room.players.forEach(p => {
            if(p.role === 'Unassigned') {
                p.role = "BOILERMAKER 🚂"; p.party = "Boilermaker";
                io.to(p.id).emit('assignRole', { role: p.role, info: "Protect the Bell Tower!" });
            }
        });

        io.to(socket.roomCode).emit('gameStarted');
        startNewRound(room);
    });

    function startNewRound(room) {
        let attempts = 0;
        do {
            room.currentPres = room.players[room.presidentialIndex];
            room.presidentialIndex = (room.presidentialIndex + 1) % room.players.length;
        } while (!room.currentPres.alive && attempts < room.players.length);

        room.currentVP = null;
        room.currentVotes = {};
        io.to(socket.roomCode).emit('updatePlayerList', getPlayerListWithStatus(room));
        io.to(socket.roomCode).emit('newRound', { presidentName: room.currentPres.name, presidentId: room.currentPres.id });
        broadcastCounts(socket.roomCode);
    }

    socket.on('nominateVP', (vpName) => {
        const room = rooms[socket.roomCode];
        room.currentVP = room.players.find(p => p.name === vpName);
        io.to(socket.roomCode).emit('startVoting', { pres: room.currentPres.name, vp: room.currentVP.name });
    });

    socket.on('submitVote', (vote) => {
        const room = rooms[socket.roomCode];
        room.currentVotes[socket.id] = vote;
        const living = room.players.filter(p => p.alive);
        if (Object.keys(room.currentVotes).length === living.length) {
            const yes = Object.values(room.currentVotes).filter(v => v === 'Boiler Up!').length;
            if (yes > (living.length / 2)) {
                room.electionTracker = 0;
                if (room.enactedPolicies.construction >= 3 && room.currentVP.role === "THE BISON 🦬") return endGame(socket.roomCode, "HOOSIERS WIN: Bison elected VP!");
                io.to(room.currentPres.id).emit('presDrawPhase');
            } else {
                room.electionTracker++;
                if (room.electionTracker >= 3) {
                    room.electionTracker = 0;
                    if(room.deck.length === 0) shuffle(room);
                    applyPolicy(socket.roomCode, room.deck.shift(), true);
                } else startNewRound(room);
            }
            updateUI(socket.roomCode);
        }
    });

    socket.on('drawThree', () => {
        const room = rooms[socket.roomCode];
        if (room.deck.length < 3) shuffle(room);
        socket.emit('presDiscardPhase', room.deck.splice(0, 3));
        broadcastCounts(socket.roomCode);
    });

    socket.on('presDiscard', (data) => {
        const room = rooms[socket.roomCode];
        room.discardPile.push(data.discarded);
        io.to(room.currentVP.id).emit('vpEnactPhase', { cards: data.kept });
    });

    socket.on('vpEnact', (data) => {
        const room = rooms[socket.roomCode];
        room.discardPile.push(data.discarded);
        applyPolicy(socket.roomCode, data.enacted);
    });

    socket.on('powerExpel', (name) => {
        const room = rooms[socket.roomCode];
        const target = room.players.find(p => p.name === name);
        target.alive = false;
        if (target.role === "THE BISON 🦬") return endGame(socket.roomCode, "BOILERMAKERS WIN: Bison Expelled!");
        startNewRound(room);
    });

    socket.on('requestVeto', () => {
        const room = rooms[socket.roomCode];
        io.to(room.currentPres.id).emit('vetoRequested');
    });

    socket.on('vetoConfirmed', (agree) => {
        const room = rooms[socket.roomCode];
        if (agree) {
            room.electionTracker++;
            startNewRound(room);
        } else {
            io.to(room.currentVP.id).emit('vetoDenied');
        }
    });

    function applyPolicy(roomCode, type, forced = false) {
        const room = rooms[roomCode];
        type === "Boilermaker" ? room.enactedPolicies.tradition++ : room.enactedPolicies.construction++;
        if (!forced) { room.lastPresident = room.currentPres.name; room.lastVP = room.currentVP.name; }
        if (room.enactedPolicies.tradition >= 5) return endGame(roomCode, "PURDUE WINS!");
        if (room.enactedPolicies.construction >= 6) return endGame(roomCode, "IU WINS!");
        
        if (type === "Hoosier" && !forced) {
            const count = room.enactedPolicies.construction;
            if (count === 3) io.to(room.currentPres.id).emit('triggerPeek', room.deck.slice(0, 3));
            else if (count >= 4) io.to(room.currentPres.id).emit('triggerExpel');
            else startNewRound(room);
        } else startNewRound(room);
        updateUI(roomCode);
    }

    function shuffle(room) {
        room.deck = [...room.deck, ...room.discardPile].sort(() => 0.5 - Math.random());
        room.discardPile = [];
        io.to(socket.roomCode).emit('reshuffleOccurred');
    }

    function updateUI(code) {
        const room = rooms[code];
        io.to(code).emit('policyUpdated', { enactedPolicies: room.enactedPolicies, electionTracker: room.electionTracker });
    }

    function broadcastCounts(code) {
        const r = rooms[code];
        io.to(code).emit('updateCounts', { deck: r.deck.length, discard: r.discardPile.length });
    }

    function endGame(code, msg) { io.to(code).emit('gameOver', msg); delete rooms[code]; }

    function getPlayerListWithStatus(room) {
        return room.players.map(p => ({
            name: p.name, alive: p.alive,
            isPres: room.currentPres && p.id === room.currentPres.id,
            isLimit: (p.name === room.lastPresident || p.name === room.lastVP)
        }));
    }
});

server.listen(3000);