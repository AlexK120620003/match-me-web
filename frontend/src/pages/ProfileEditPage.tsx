import { FormEvent, useEffect, useState } from 'react';
import { api, apiUpload } from '../api/client';
import Avatar from '../components/Avatar';
import type { Profile, Bio, UserSummary } from '../api/types';

const WORKOUT_TYPES = ['strength', 'cardio', 'yoga', 'crossfit', 'calisthenics', 'hiit', 'powerlifting', 'bodybuilding', 'running', 'cycling', 'swimming', 'boxing', 'martial_arts'];
const GOALS = ['lose_weight', 'build_muscle', 'endurance', 'strength', 'flexibility', 'competition_prep', 'general_fitness', 'recomp'];
const LOOKING_FOR = ['spotter', 'motivator', 'same_level', 'trainer', 'trainee', 'accountability'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const INTENSITIES = ['chill', 'moderate', 'intense'];
const GENDERS = ['male', 'female', 'other'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIMES = ['morning', 'afternoon', 'evening'];

function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export default function ProfileEditPage() {
  const [me, setMe] = useState<UserSummary | null>(null);
  const [email, setEmail] = useState<string>('');
  const [displayName, setDisplayName] = useState('');

  const [aboutMe, setAboutMe] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [gender, setGender] = useState<string>('');
  const [city, setCity] = useState('');

  const [workoutTypes, setWorkoutTypes] = useState<string[]>([]);
  const [level, setLevel] = useState<string>('');
  const [scheduleSlots, setScheduleSlots] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [gymName, setGymName] = useState('');
  const [intensity, setIntensity] = useState<string>('');

  const [isComplete, setIsComplete] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function reload() {
    const u = await api<UserSummary>('/me');
    const p = await api<Profile>('/me/profile');
    const b = await api<Bio>('/me/bio');
    const e = await api<{ email: string }>('/me/email');
    setMe(u);
    setEmail(e.email);
    setDisplayName(u.displayName);
    setAboutMe(p.aboutMe ?? '');
    setAge(p.age ?? '');
    setGender(p.gender ?? '');
    setCity(p.city ?? '');
    setIsComplete(p.isComplete);
    setWorkoutTypes(b.workoutTypes);
    setLevel(b.experienceLevel ?? '');
    setScheduleSlots(b.scheduleSlots);
    setGoals(b.goals);
    setLookingFor(b.lookingFor);
    setGymName(b.gymName ?? '');
    setIntensity(b.intensity ?? '');
  }

  useEffect(() => { reload(); }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api('/me', { method: 'PUT', json: { displayName } });
      await api('/me/profile', {
        method: 'PUT',
        json: {
          aboutMe: aboutMe || null,
          age: age === '' ? null : Number(age),
          gender: gender || null,
          city: city || null,
        },
      });
      await api('/me/bio', {
        method: 'PUT',
        json: {
          workoutTypes,
          experienceLevel: level || null,
          scheduleSlots,
          goals,
          lookingFor,
          gymName: gymName || null,
          intensity: intensity || null,
        },
      });
      setStatus('Saved ✓');
      await reload();
    } catch (err: any) {
      setStatus(`Error: ${err?.message ?? 'unknown'}`);
    }
  }

  async function onAvatar(file: File) {
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      await apiUpload('/me/avatar', fd);
      await reload();
    } catch (err: any) {
      setStatus(`Upload failed: ${err?.message ?? 'unknown'}`);
    }
  }

  async function onDeleteAvatar() {
    await api('/me/avatar', { method: 'DELETE' });
    await reload();
  }

  if (!me) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <h1>My profile</h1>
      <p className="muted">
        Status: {isComplete ? '✓ complete' : '⚠ incomplete — fill at least 5 bio data points (workout types, level, schedule, goals, looking for, city)'}
      </p>

      <div className="card">
        <div className="row">
          <Avatar url={me.avatarUrl} size={80} />
          <div className="col">
            <input type="file" accept="image/*" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAvatar(f);
            }} />
            {me.avatarUrl && <button type="button" onClick={onDeleteAvatar}>Remove avatar</button>}
          </div>
        </div>
        <p className="muted">Email (private): {email}</p>
      </div>

      <form onSubmit={onSave} className="col">
        <div className="card col">
          <h2>About you</h2>
          <label>Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <label>About me
            <textarea rows={3} value={aboutMe} onChange={(e) => setAboutMe(e.target.value)} maxLength={2000} />
          </label>
          <div className="row">
            <label>Age <input type="number" min={14} max={120} value={age} onChange={(e) => setAge(e.target.value === '' ? '' : Number(e.target.value))} /></label>
            <label>Gender
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">-</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label>City <input value={city} onChange={(e) => setCity(e.target.value)} /></label>
          </div>
        </div>

        <div className="card col">
          <h2>Gym & training</h2>
          <label>Gym name <input value={gymName} onChange={(e) => setGymName(e.target.value)} /></label>
          <label>Experience level
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">-</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label>Intensity
            <select value={intensity} onChange={(e) => setIntensity(e.target.value)}>
              <option value="">-</option>
              {INTENSITIES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>

          <fieldset>
            <legend>Workout types</legend>
            {WORKOUT_TYPES.map((w) => (
              <label key={w} className="pill">
                <input type="checkbox" checked={workoutTypes.includes(w)} onChange={() => setWorkoutTypes(toggle(workoutTypes, w))} />
                {' '}{w}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Goals</legend>
            {GOALS.map((w) => (
              <label key={w} className="pill">
                <input type="checkbox" checked={goals.includes(w)} onChange={() => setGoals(toggle(goals, w))} />
                {' '}{w}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Looking for</legend>
            {LOOKING_FOR.map((w) => (
              <label key={w} className="pill">
                <input type="checkbox" checked={lookingFor.includes(w)} onChange={() => setLookingFor(toggle(lookingFor, w))} />
                {' '}{w}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Schedule</legend>
            <table>
              <thead>
                <tr><th></th>{TIMES.map((t) => <th key={t}>{t}</th>)}</tr>
              </thead>
              <tbody>
                {DAYS.map((d) => (
                  <tr key={d}>
                    <td>{d}</td>
                    {TIMES.map((t) => {
                      const slot = `${d}_${t}`;
                      return (
                        <td key={slot}>
                          <input type="checkbox" checked={scheduleSlots.includes(slot)} onChange={() => setScheduleSlots(toggle(scheduleSlots, slot))} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        </div>

        <div className="row">
          <button type="submit">Save</button>
          {status && <span className="muted">{status}</span>}
        </div>
      </form>
    </div>
  );
}
