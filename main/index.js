const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let players = [];
let deck = [];
let enactedPolicies = { tradition: [], construction: [] };
let lastPresident = null;
let lastVP = null;
let currentPres = null;
let currentVP = null;

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
        if (players.length < 5) {
            socket.emit('errorMsg', "Official rules require 5+ players!");
            return;
        }
        createDeck();
        enactedPolicies = { tradition: [], construction: [] };
        let shuffled = [...players].sort(() => 0.5 - Math.random());
        
        const bison = shuffled[0];
        const spy = shuffled[1];

        players.forEach(p => {
            if (p.id === bison.id) p.role = "THE BISON 🦬";
            else if (p.id === spy.id) p.role = "HOOSIER SPY 🚩";
            else p.role = "BOILERMAKER 🚂";
            io.to(p.id).emit('assignRole', p.role);
        });
        io.emit('gameStarted');
    });

    socket.on('nominateVP', (vpName) => {
        const nominee = players.find(p => p.name.toLowerCase() === vpName.toLowerCase());
        const president = players.find(p => p.id === socket.id);
        if (nominee) {
            // Term Limit Check
            if (nominee.name === lastVP || (players.length > 5 && nominee.name === lastPresident)) {
                return socket.emit('errorMsg', nominee.name + " is term-limited!");
            }
            currentPres = president;
            currentVP = nominee;
            io.emit('showVote', { president: president.name, vp: nominee.name });
        }
    });

    socket.on('submitVote', (voteData) => {
        io.emit('voteResult', voteData);
    });

    socket.on('drawPolicies', () => {
        if (enactedPolicies.construction.length >= 3 && currentVP.role === "THE BISON 🦬") {
            io.emit('statusMsg', "HOOSIERS WIN: The Bison was elected Student Body VP!");
            return;
        }
        if (deck.length < 3) createDeck();
        const hand = deck.splice(0, 3);
        socket.emit('presidentHand', hand);
    });

    socket.on('presidentDiscard', (remainingTwo) => {
        io.to(currentVP.id).emit('vpHand', remainingTwo);
    });

    socket.on('enactPolicy', (policy) => {
        const policyObj = { type: policy, pres: currentPres.name, vp: currentVP.name };
        if (policy === "Tradition") enactedPolicies.tradition.push(policyObj);
        else enactedPolicies.construction.push(policyObj);
        
        lastPresident = currentPres.name;
        lastVP = currentVP.name;

        io.emit('policyUpdated', enactedPolicies);
        
        if (enactedPolicies.tradition.length >= 5) io.emit('statusMsg', "BOILERMAKERS WIN!");
        else if (enactedPolicies.construction.length >= 6) io.emit('statusMsg', "HOOSIERS WIN!");
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

server.listen(3000, () => { console.log('Server running at http://localhost:3000'); });