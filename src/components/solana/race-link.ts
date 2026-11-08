import { DRONE_IDS, type DroneId } from "@/content/ids";

/** A race's course is `${droneId}-${courseId}`, the same key the flight range submits laps under. */
export function splitRaceCourse(course: string): { drone: DroneId; courseId: string } | null {
  const drone = [...DRONE_IDS].sort((a, b) => b.length - a.length).find((id) => course.startsWith(`${id}-`));
  return drone ? { drone, courseId: course.slice(drone.length + 1) } : null;
}

/** The drone fly page for a race, with the race id the workspace reads. */
export function raceFlyHref(lang: string, course: string, raceId: bigint | number | string): string | null {
  const parts = splitRaceCourse(course);
  return parts ? `/${lang}/drones/${parts.drone}/fly?race=${raceId}&course=${parts.courseId}` : null;
}
