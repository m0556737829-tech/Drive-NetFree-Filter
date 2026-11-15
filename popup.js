const toggle=document.getElementById('toggle');
chrome.storage.sync.get({dnfEnabled:true},v=>toggle.checked=v.dnfEnabled);
toggle.addEventListener('change',()=>chrome.storage.sync.set({dnfEnabled:toggle.checked}));
document.getElementById('rescan').addEventListener('click',async()=>{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(tab?.id) chrome.tabs.sendMessage(tab.id,{type:'DNF_RESCAN'}).catch(()=>{});
 document.getElementById('status').textContent='נשלחה בקשה לסריקה מחדש.';
});