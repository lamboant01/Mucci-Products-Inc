const test = require("node:test");
const assert = require("node:assert/strict");
const cards = require("../card-core.js");

function storage(){const data=new Map();return{getItem:(k)=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v),removeItem:(k)=>data.delete(k)};}
test("validToken rejects sequential and short tokens",()=>{assert.equal(cards.validToken("1"),false);assert.equal(cards.validToken("7F3K9QX2"),false);assert.equal(cards.validToken("f4DK_9q0Lw2-a8Zx"),true);});
test("rememberScan stores only a token and timestamps",()=>{const s=storage();cards.rememberScan(s,"f4DK_9q0Lw2-a8Zx","2026-01-01T00:00:00Z");assert.deepEqual(cards.getScans(s),[{publicToken:"f4DK_9q0Lw2-a8Zx",firstScannedAt:"2026-01-01T00:00:00Z",lastViewedAt:"2026-01-01T00:00:00Z"}]);});
test("removeScan removes its public cache",()=>{const s=storage(),token="f4DK_9q0Lw2-a8Zx";cards.rememberScan(s,token);cards.cachePublicProfile(s,token,{name:"Anthony",owner_user_id:"private"});cards.removeScan(s,token);assert.deepEqual(cards.getScans(s),[]);assert.equal(cards.getCache(s)[token],undefined);});
test("offline cache allowlists public fields",()=>{const s=storage(),token="f4DK_9q0Lw2-a8Zx";cards.cachePublicProfile(s,token,{name:"Anthony",owner_user_id:"secret"});assert.deepEqual(cards.getCache(s)[token].profile,{name:"Anthony"});});
test("vCard is version 3 and escapes delimiters",()=>{const card=cards.generateVCard({name:"Mucci, Anthony",company:"Mucci; Products",email:"a@example.ca"});assert.match(card,/VERSION:3.0/);assert.match(card,/FN:Mucci\\, Anthony/);assert.match(card,/ORG:Mucci\\; Products/);});
test("card URL encodes token and strips trailing slash",()=>{assert.equal(cards.cardUrl("https://mucciproducts.ca/","abc_def-123456789"),"https://mucciproducts.ca/card/abc_def-123456789");});
