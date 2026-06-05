
let currentUser = null;

function login(){
const company=document.getElementById('company').value.toLowerCase();
const username=document.getElementById('username').value.toLowerCase();
const pin=document.getElementById('pin').value;

db.ref(`companies/${company}/users/${username}`).once('value').then(snap=>{
if(!snap.exists()){
document.getElementById('status').innerText='User not found';
return;
}

const data=snap.val();

if(data.pin===pin){
currentUser={company,username};
document.getElementById('status').innerText='Login successful';
document.getElementById('dashboard').style.display='block';
loadLogs();
}else{
document.getElementById('status').innerText='Invalid PIN';
}
});
}

function punchIn(){
if(!currentUser) return;

const log={
type:'Punch In',
time:new Date().toLocaleString()
};

db.ref(`attendance/${currentUser.company}/${currentUser.username}`).push(log);
loadLogs();
}

function punchOut(){
if(!currentUser) return;

const log={
type:'Punch Out',
time:new Date().toLocaleString()
};

db.ref(`attendance/${currentUser.company}/${currentUser.username}`).push(log);
loadLogs();
}

function loadLogs(){
if(!currentUser) return;

db.ref(`attendance/${currentUser.company}/${currentUser.username}`).once('value').then(snap=>{
const logsDiv=document.getElementById('logs');
logsDiv.innerHTML='';

snap.forEach(child=>{
const d=child.val();
logsDiv.innerHTML+=`<div class="log">${d.type} - ${d.time}</div>`;
});
});
}

function logout(){
location.reload();
}
