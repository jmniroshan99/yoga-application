import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {Router} from 'express';
import type {Request, Response, NextFunction} from 'express';
import {z} from 'zod';
import {actor, type Actor, config, fail, one, pool, route} from './core.js';

export const authRouter = Router();
const cookieName = 'sahana_session';
const cookieOptions = {httpOnly:true, sameSite:'lax' as const, secure:config.secureCookies, path:'/'};
const hash = (value:string) => crypto.createHash('sha256').update(value).digest('hex');
const loginAttempts=new Map<string,{count:number;until:number}>();

export const authenticate = (req:Request, _res:Response, next:NextFunction) => { void (async()=>{
  const token = req.cookies?.[cookieName] as string|undefined;
  if (!token) return;
  const user = await one<Actor>(pool, `SELECT u.id,u.name,u.email,u.role,u.branch_id,u.locale FROM auth_sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,[hash(token)]);
  if (user) req.actor=user;
})().then(()=>next()).catch(next); };
export function requireSession(req:Request, _res:Response, next:NextFunction) {
  try {actor(req); next();} catch(error) {next(error);}
}
async function signIn(res:Response, userId:string) {
  const token=crypto.randomBytes(32).toString('base64url');
  await pool.query("INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",[userId,hash(token)]);
  res.cookie(cookieName,token,{...cookieOptions,maxAge:7*86400000});
}
const registration=z.object({name:z.string().trim().min(2).max(100),email:z.string().email().max(200),password:z.string().min(12).max(128),birthDate:z.string().date(),locale:z.enum(['en','si','ta']).default('en'),phone:z.string().max(30).optional()});
authRouter.post('/register',route(async(req,res)=>{
  const input=registration.parse(req.body);
  const age=new Date().getUTCFullYear()-Number(input.birthDate.slice(0,4));
  const birth=new Date(input.birthDate+'T00:00:00Z');
  const adultCutoff=new Date(); adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear()-18);
  if (!Number.isFinite(birth.getTime()) || birth>adultCutoff || age>120) fail(422,'MINOR_POLICY','This demo currently accepts clients aged 18 or over.');
  const passwordHash=await bcrypt.hash(input.password,12);
  try {
    const created=await one<{id:string}>(pool,'INSERT INTO users(email,password_hash,name,phone,birth_date,locale) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [input.email.trim().toLowerCase(),passwordHash,input.name,input.phone||null,input.birthDate,input.locale]);
    await signIn(res,created!.id); res.status(201).json({ok:true});
  } catch(error) {if ((error as {code?:string}).code==='23505') fail(409,'ACCOUNT_EXISTS','An account already exists for this email.'); throw error;}
}));
authRouter.post('/login',route(async(req,res)=>{
  const input=z.object({email:z.string().email(),password:z.string()}).parse(req.body);
  const key=req.ip||'unknown',now=Date.now(),prior=loginAttempts.get(key);
  if(loginAttempts.size>1000) for(const [ip,value] of loginAttempts) if(value.until<=now) loginAttempts.delete(ip);
  if(prior&&prior.until>now&&prior.count>=8) fail(429,'LOGIN_RATE_LIMIT','Too many attempts. Try again later.');
  const row=await one<{id:string;password_hash:string}>(pool,'SELECT id,password_hash FROM users WHERE email=$1 AND active=true',[input.email.trim().toLowerCase()]);
  if (!row || !(await bcrypt.compare(input.password,row.password_hash))) {
    loginAttempts.set(key,{count:prior&&prior.until>now?prior.count+1:1,until:now+15*60000});
    fail(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
  }
  loginAttempts.delete(key);
  await signIn(res,row.id); res.json({ok:true});
}));
authRouter.post('/logout',route(async(req,res)=>{
  const token=req.cookies?.[cookieName] as string|undefined;
  if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[hash(token)]);
  res.clearCookie(cookieName,cookieOptions); res.json({ok:true});
}));
authRouter.get('/me',route(async(req,res)=>res.json({user:req.actor||null})));
authRouter.patch('/me',requireSession,route(async(req,res)=>{
  const input=z.object({name:z.string().trim().min(2).max(100).optional(),phone:z.string().max(30).nullable().optional(),locale:z.enum(['en','si','ta']).optional()}).parse(req.body);
  const user=actor(req);
  const result=await one<Actor>(pool,'UPDATE users SET name=COALESCE($2,name),phone=COALESCE($3,phone),locale=COALESCE($4,locale) WHERE id=$1 RETURNING id,name,email,role,branch_id,locale',
    [user.id,input.name??null,input.phone??null,input.locale??null]); res.json({user:result});
}));
