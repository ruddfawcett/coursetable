import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from 'react';
import axios from 'axios';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import { toast } from 'react-toastify';

type Season = string;
type NetId = string;
type Worksheet = [Season, string][];
type FBInfo = {
  worksheets: {
    [key in NetId]: Worksheet;
  };
  friendInfo: {
    [key in NetId]: {
      name: string;
      facebookId: string;
    };
  };
};
type Store = {
  user: {
    netId?: NetId;
    worksheet?: Worksheet;
    hasEvals?: boolean;
    fbLogin?: boolean;
    fbWorksheets?: FBInfo;
  };
  userRefresh(suppressError?: boolean): Promise<void>;
  fbRefresh(suppressError?: boolean): Promise<void>;
};

const UserContext = createContext<Store | undefined>(undefined);
UserContext.displayName = 'UserContext';

/**
 * Stores the user's worksheet, FB login status, and FB friends' worksheets
 */
export const UserProvider: React.FC<{}> = ({ children }) => {
  // User's netId
  const [netId, setNetId] = useState<string | undefined>(undefined);
  // User's worksheet
  const [worksheet, setWorksheet] = useState<Worksheet | undefined>(undefined);
  // User's evals enabled status
  const [hasEvals, setHasEvals] = useState<boolean | undefined>(undefined);
  // User's FB login status
  const [fbLogin, setFbLogin] = useState<boolean | undefined>(undefined);
  // User's FB friends' worksheets
  const [fbWorksheets, setFbWorksheets] = useState<FBInfo | undefined>(
    undefined
  );

  // Refresh user worksheet
  const userRefresh = useCallback(
    async (suppressError: boolean = false) => {
      const res = await axios.get(
        '/legacy_api/WorksheetActions.php?action=get&season=all'
      );
      if (!res.data.success) {
        // Error with fetching user's worksheet
        setNetId(undefined);
        setWorksheet(undefined);
        setHasEvals(undefined);
        posthog.reset();
        Sentry.configureScope((scope) => scope.clear());
        console.error(res.data.message);
        if (!suppressError) {
          toast.error(res.data.message);
        }
      } else {
        // Successfully fetched worksheet
        setNetId(res.data.netId);
        setHasEvals(res.data.evaluationsEnabled);
        setWorksheet(res.data.data);
        posthog.identify(res.data.netId);
        Sentry.setUser({ username: res.data.netId });
      }
    },
    [setWorksheet, setNetId, setHasEvals]
  );

  // Refresh user FB stuff
  const fbRefresh = useCallback(
    async (suppressError: boolean = false) => {
      const friends_worksheets = await axios.get(
        '/legacy_api/FetchFriendWorksheetsNew.php'
      );
      if (!friends_worksheets.data.success) {
        // Error with fetching friends' worksheets
        console.log(friends_worksheets.data.message);
        if (!suppressError) {
          toast.error(friends_worksheets.data.message);
        }
        setFbLogin(false);
        setFbWorksheets(undefined);
      } else {
        // Successfully fetched friends' worksheets
        setFbLogin(true);
        setFbWorksheets(friends_worksheets.data);
      }
    },
    [setFbLogin, setFbWorksheets]
  );

  const user = useMemo(() => {
    return {
      netId,
      worksheet,
      hasEvals,
      fbLogin,
      fbWorksheets,
    };
  }, [netId, worksheet, hasEvals, fbLogin, fbWorksheets]);

  const store = useMemo(
    () => ({
      // Context state.
      user,

      // Update methods.
      userRefresh,
      fbRefresh,
    }),
    [user, userRefresh, fbRefresh]
  );

  return <UserContext.Provider value={store}>{children}</UserContext.Provider>;
};

export const useUser = () => useContext(UserContext)!;
