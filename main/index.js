const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let players = [];
let deck = [];
let enactedPolicies = { tradition: [], construction: [] };
let currentChancellor = null;
let currentPresident = null;

function createDeck() {
    deck = [...Array(6).fill("Tradition"), ...Array(11).fill("Construction")];
    deck.sort(() => 0.5 - Math.random());
}

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        players.push({ id: socket.id, name: name, role: 'Unassigned' });
        io.emit('updatePlayerList', players);
    });

    socket.on('startGame', () => {
        if (players.length < 2) return;
        createDeck();
        enactedPolicies = { tradition: [], construction: [] };
        let shuffled = [...players].sort(() => 0.5 - Math.random());
        players.forEach(p => {
            p.role = (p.id === shuffled[0].id) ? "IU SPY 🚩" : "BOILERMAKER 🚂";
            io.to(p.id).emit('assignRole', p.role);
        });
        io.emit('gameStarted');
    });

    // 1. President Nominates Chancellor
    socket.on('nominateChancellor', (chancellorName) => {
        const nominee = players.find(p => p.name.toLowerCase() === chancellorName.toLowerCase());
        const president = players.find(p => p.id === socket.id);
        if (nominee) {
            currentPresident = president;
            currentChancellor = nominee;
            io.emit('showVote', { president: president.name, chancellor: nominee.name });
        } else {
            socket.emit('errorMsg', "Student not found!");
        }
    });

    socket.on('submitVote', (voteData) => {
        io.emit('voteResult', voteData);
    });

    // 2. President Draws 3, Discards 1
    socket.on('drawPolicies', () => {
        if (deck.length < 3) createDeck();
        const hand = deck.splice(0, 3);
        socket.emit('presidentHand', hand);
    });

    // 3. President passes 2 to Chancellor
    socket.on('presidentDiscard', (remainingTwo) => {
        io.to(currentChancellor.id).emit('chancellorHand', remainingTwo);
    });

    // 4. Chancellor Enacts 1
    socket.on('enactPolicy', (policy) => {
        const policyObj = { type: policy, pres: currentPresident.name, chan: currentChancellor.name };
        if (policy === "Tradition") enactedPolicies.tradition.push(policyObj);
        else enactedPolicies.construction.push(policyObj);
        
        io.emit('policyUpdated', enactedPolicies);
        io.emit('statusMsg', `Policy Enacted by ${currentPresident.name} and ${currentChancellor.name}`);
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

server.listen(3000, () => { console.log('Server running at http://localhost:3000'); });