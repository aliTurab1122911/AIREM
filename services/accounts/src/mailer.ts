import net from 'node:net';
import tls from 'node:tls';
import { Config } from './config.js';
import { TokenMailer } from './app.js';

type Socket=net.Socket|tls.TLSSocket;
const readReply=(socket:Socket)=>new Promise<string>((resolve,reject)=>{let text='';const data=(chunk:Buffer)=>{text+=chunk.toString();const lines=text.split(/\r?\n/).filter(Boolean);if(lines.length&&/^\d{3} /.test(lines.at(-1)!)){cleanup();resolve(text)}};const error=(e:Error)=>{cleanup();reject(e)};const cleanup=()=>{socket.off('data',data);socket.off('error',error)};socket.on('data',data);socket.on('error',error)});
async function command(socket:Socket,value:string,expected:number[]){socket.write(`${value}\r\n`);const reply=await readReply(socket),code=Number(reply.slice(0,3));if(!expected.includes(code))throw new Error(`SMTP command failed (${code})`);}
const dotStuff=(value:string)=>value.replace(/^\./gm,'..');

export function createMailer(cfg:Config):TokenMailer{
 async function send(to:string,subject:string,url:string){
  const socket:Socket=cfg.SMTP_SECURE?tls.connect({host:cfg.SMTP_HOST,port:cfg.SMTP_PORT,servername:cfg.SMTP_HOST}):net.connect({host:cfg.SMTP_HOST,port:cfg.SMTP_PORT});
  try{const greeting=await readReply(socket);if(!greeting.startsWith('220'))throw new Error('SMTP server rejected connection');await command(socket,'EHLO airem',[250]);if(cfg.SMTP_USER)await command(socket,`AUTH PLAIN ${Buffer.from(`\0${cfg.SMTP_USER}\0${cfg.SMTP_PASSWORD}`).toString('base64')}`,[235]);await command(socket,`MAIL FROM:<${cfg.MAIL_FROM}>`,[250]);await command(socket,`RCPT TO:<${to}>`,[250,251]);await command(socket,'DATA',[354]);const body=[`From: Airem <${cfg.MAIL_FROM}>`,`To: ${to}`,`Subject: ${subject}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','','Open this link to continue. It expires shortly and can only be used once:','',url,''].join('\r\n');await command(socket,`${dotStuff(body)}\r\n.`,[250]);await command(socket,'QUIT',[221]);}finally{socket.destroy()}
 }
 const link=(path:string,token:string)=>{const url=new URL(path,cfg.APP_ORIGIN);url.searchParams.set('token',token);return url.toString()};
 return {sendVerification:(email,token)=>send(email,'Verify your Airem email',link('/verify-email',token)),sendPasswordReset:(email,token)=>send(email,'Reset your Airem password',link('/reset-password',token))};
}
