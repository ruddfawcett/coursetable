import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import axios from 'axios';
import AsyncLock from 'async-lock';
import { toast } from 'react-toastify';
import _seasons from '../generated/seasons.json';
import { CatalogBySeasonQuery } from '../generated/graphql';
import { Crn, Season } from '../common';

// Preprocess seasons data.
// We need to wrap this inside the "seasons" key of an object
// to maintain compatibility with the previous graphql version.
// TODO: once typescript is fully added, we can easily find all
// the usages and remove the enclosing object.
const seasons = {
  seasons: [..._seasons].reverse(),
};

type Listing = CatalogBySeasonQuery['computed_listing_info'][0] & {
  // Narrow some types.
  // TODO: use Omit<T> instead.
  season_code?: Season;
  areas: string[];
  skills: string[];
  // TODO: add some more here
  // times_by_day
  // professor_names
  // all_course_codes
  // areas
  // a bunch of the average ratings

  // Add a couple types created by the preprocessing step.
  professors?: string;
  professor_avg_rating?: number;
};

// Preprocess course data.
const preprocess_courses = (listing: Listing) => {
  // trim decimal points in ratings floats
  const RATINGS_PRECISION = 1;

  // Combine array of professors into one string
  if ('professor_names' in listing && listing['professor_names'].length > 0) {
    listing['professors'] = listing['professor_names'].join(', ');
    // for the average professor rating, take the first professor
    if ('average_professor' in listing && listing['average_professor'] !== null)
      // Trim professor ratings to one decimal point
      listing['professor_avg_rating'] = listing['average_professor'].toFixed(
        RATINGS_PRECISION
      );
  }
  return listing;
};

// Global course data cache.
const courseDataLock = new AsyncLock();
let courseLoadAttempted: { [key in Season]: boolean } = {};
let courseData: { [key in Season]: Map<Crn, Listing> } = {};
const addToCache = (season: Season): Promise<void> => {
  return courseDataLock.acquire(`load-${season}`, () => {
    if (season in courseData || season in courseLoadAttempted) {
      // Skip if already loaded, or if we previously tried to load it.
      return;
    }

    // Log that we attempted to load this.
    courseLoadAttempted = {
      ...courseLoadAttempted,
      [season]: true,
    };

    return axios.get(`/api/static/catalogs/${season}.json`).then((res) => {
      // Convert season list into a crn lookup table.
      const data = res.data as Listing[];
      const info = new Map<Crn, Listing>();
      for (const raw_listing of data) {
        const listing = preprocess_courses(raw_listing);
        info.set(listing.crn, listing);
        // TODO: make certain columns non-nullable
      }

      // Save in global cache. Here we force the creation of a new object.
      courseData = {
        ...courseData,
        [season]: info,
      };
    });
  });
};

type Store = {
  requests: number;
  loading: boolean;
  error: string | null;
  seasons: typeof seasons;
  courses: typeof courseData;
  requestSeasons(seasons: Season[]): void;
};

const FerryCtx = createContext<Store | undefined>(undefined);
FerryCtx.displayName = 'FerryCtx';

export const FerryProvider: React.FC = ({ children }) => {
  // Note that we track requests for force a re-render when
  // courseData changes.
  const [requests, setRequests] = useState(0);
  const diffRequests = useCallback(
    (diff) => {
      setRequests((requests) => requests + diff);
    },
    [setRequests]
  );

  const [errors, setErrors] = useState<string[]>([]);
  const addError = useCallback(
    (err) => {
      setErrors((errors) => [...errors, err]);
    },
    [setErrors]
  );

  const requestSeasons = useCallback(
    (seasons: Season[]) => {
      const fetches = seasons.map((season) => {
        // Racy preemptive check of cache.
        // We cannot check courseLoadAttempted here, since that is set prior
        // to the data actually being loaded.
        if (season in courseData) {
          return Promise.resolve();
        }

        // Add to cache.
        diffRequests(+1);
        return addToCache(season).finally(() => {
          diffRequests(-1);
        });
      });
      Promise.all(fetches).catch((err) => {
        toast.error('Failed to fetch course information');
        console.error(err);
        addError(err);
      });
    },
    [diffRequests, addError]
  );

  // If there's any error, we want to immediately stop "loading" and start "erroring".
  const error = errors[0] ?? null;
  const loading = requests !== 0 && !error;

  const store: Store = useMemo(
    () => ({
      requests,
      loading,
      error: error,
      seasons,
      courses: courseData,
      requestSeasons,
    }),
    [loading, error, requests, requestSeasons]
  );

  return <FerryCtx.Provider value={store}>{children}</FerryCtx.Provider>;
};

export default FerryProvider;
export const useFerry = () => useContext(FerryCtx)!;
export const useCourseData = (seasons: Season[]) => {
  const { error, courses, requestSeasons } = useFerry();

  useEffect(() => {
    requestSeasons(seasons);
  }, [requestSeasons, seasons]);

  // If not everything is loaded, we're still loading.
  // But if we hit an error, stop loading immediately.
  const loading = !error && !seasons.every((season) => courses[season]);

  return { loading, error, courses };
};