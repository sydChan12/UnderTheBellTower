const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Game State Variables
let players = [];
let deck = [];
let discardPile = [];
let enactedPolicies = { tradition: 0, construction: 0 };
let electionTracker = 0;
let lastPresident = null;
let lastVP = null;
let currentPres = null;
let currentVP = null;
let currentVotes = {};

/**
 * Official Setup: 11 Construction (Fascist), 6 Tradition (Liberal) [cite: 38]
 */
function createDeck() {
    deck = [...Array(6).fill("Tradition"), ...Array(11).fill("Construction")];
    deck.sort(() => 0.5 - Math.random());
}

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        if (players.length < 10) {
            players.push({ id: socket.id, name, role: 'Unassigned', party: 'Liberal' });
            io.emit('updatePlayerList', players.map(p => p.name));
        }
    });

    socket.on('startGame', () => {
        if (players.length < 5) return socket.emit('errorMsg', "Need 5 players! [cite: 56]");
        
        createDeck();
        enactedPolicies = { tradition: 0, construction: 0 };
        electionTracker = 0;

        // Role Distribution for 5 Players: 3 Boilermakers, 1 Hoosier Spy, 1 Bison [cite: 56]
        let shuffled = [...players].sort(() => 0.5 - Math.random());
        players.forEach(p => {
            if (p.id === shuffled[0].id) { p.role = "THE BISON 🦬"; p.party = "Hoosier"; }
            else if (p.id === shuffled[1].id) { p.role = "HOOSIER SPY 🚩"; p.party = "Hoosier"; }
            else { p.role = "BOILERMAKER 🚂"; p.party = "Boilermaker"; }
            io.to(p.id).emit('assignRole', { role: p.role, party: p.party });
        });
        io.emit('statusMsg', "The semester has begun. President, nominate your VP.");
    });

    /**
     * Phase 1: Nomination [cite: 88]
     */
    socket.on('nominateVP', (vpName) => {
        const nominee = players.find(p => p.name === vpName);
        const pres = players.find(p => p.id === socket.id);

        if (!nominee || nominee.id === socket.id) return socket.emit('errorMsg', "Invalid nominee.");
        
        // Term Limit Check: Last elected Pres/VP are ineligible [cite: 92, 99]
        if (nominee.name === lastVP || (players.length > 5 && nominee.name === lastPresident)) {
            return socket.emit('errorMsg', `${vpName} is term-limited! `);
        }

        currentPres = pres;
        currentVP = nominee;
        currentVotes = {};
        io.emit('startVoting', { pres: pres.name, vp: nominee.name });
    });

    /**
     * Phase 2: Voting [cite: 103, 108]
     */
    socket.on('submitVote', (vote) => {
        currentVotes[socket.id] = vote;
        if (Object.keys(currentVotes).length === players.length) {
            const yes = Object.values(currentVotes).filter(v => v === 'Boiler Up!').length;
            const no = players.length - yes;

            if (yes > no) {
                electionTracker = 0;
                // Win Condition: Bison elected VP after 3 Construction policies [cite: 24, 120]
                if (enactedPolicies.construction >= 3 && currentVP.role === "THE BISON 🦬") {
                    return io.emit('gameOver', "HOOSIERS WIN: The Bison was elected VP! [cite: 24]");
                }
                io.emit('statusMsg', `Election Passed (${yes}-${no}). President, draw policies.`);
                io.to(currentPres.id).emit('presDrawPhase');
            } else {
                electionTracker++;
                io.emit('statusMsg', `Election Failed (${yes}-${no}). Tracker: ${electionTracker}/3 [cite: 110]`);
                
                // Chaos Rule: 3 failed elections enacts top policy [cite: 111]
                if (electionTracker >= 3) {
                    const chaosPolicy = deck.shift();
                    chaosPolicy === "Tradition" ? enactedPolicies.tradition++ : enactedPolicies.construction++;
                    electionTracker = 0;
                    io.emit('policyUpdated', { enactedPolicies, electionTracker });
                    io.emit('statusMsg', `CHAOS! Top policy enacted: ${chaosPolicy} [cite: 112]`);
                }
            }
        }
    });

    /**
     * Phase 3: Legislative Session [cite: 123]
     */
    socket.on('drawThree', () => {
        if (deck.length < 3) { deck = [...deck, ...discardPile].sort(() => 0.5 - Math.random()); discardPile = []; }
        const hand = deck.splice(0, 3);
        socket.emit('presDiscardPhase', hand);
    });

    socket.on('presDiscard', (remainingTwo) => {
        io.to(currentVP.id).emit('vpEnactPhase', remainingTwo);
    });

    socket.on('vpEnact', (chosen) => {
        chosen === "Tradition" ? enactedPolicies.tradition++ : enactedPolicies.construction++;
        lastPresident = currentPres.name;
        lastVP = currentVP.name;

        io.emit('policyUpdated', { enactedPolicies, electionTracker: 0 });
        
        // Final Victory Checks [cite: 23, 24]
        if (enactedPolicies.tradition >= 5) io.emit('gameOver', "BOILERMAKERS WIN! 🚂 [cite: 23]");
        if (enactedPolicies.construction >= 6) io.emit('gameOver', "HOOSIERS WIN! 🚩 [cite: 24]");
    });
});

server.listen(3000, () => console.log('Purdue Server: http://localhost:3000'));