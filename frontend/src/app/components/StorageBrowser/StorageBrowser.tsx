import { useTranslation } from 'react-i18next';
import config from '@app/config';
import { base64Decode, base64Encode } from '@app/utils/encoding';
import { createAuthenticatedEventSource } from '@app/utils/sseTickets';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Card,
  Checkbox,
  Content,
  ContentVariants,
  DropEvent,
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  FileUpload,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MultipleFileUpload,
  MultipleFileUploadMain,
  MultipleFileUploadStatus,
  MultipleFileUploadStatusItem,
  PageSection,
  Progress,
  ProgressSize,
  Skeleton,
  Spinner,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  InfoCircleIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, ThProps, Thead, Tr } from '@patternfly/react-table';
import apiClient from '@app/utils/apiClient';
import * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from '@app/utils/notifications';
import { validateS3ObjectName } from '@app/utils/validation';
import DocumentRenderer from '../DocumentRenderer/DocumentRenderer';
import FileDetailsModal from './FileDetailsModal';
import { ExtendedFile, UploadedFile } from './storageBrowserTypes';
import HfLogo from '@app/assets/bgimages/hf-logo.svg';
import pLimit from 'p-limit';
import { FileEntry, StorageLocation, storageService } from '@app/services/storageService';
import { TransferAction } from '@app/components/Transfer';
import { formatBytes } from '@app/utils/format';
import { MobileCardItem, MobileCardView, ResponsiveTableWrapper } from '@app/components/ResponsiveTable';
import { DEFAULT_PAGE_SIZE, getAvailablePageSizes, snapToNearestPreset } from '@app/utils/paginationPresets';

const StorageBrowser: React.FC = () => {
  const { t } = useTranslation('storage-browser');
  const { t: tCommon } = useTranslation('translation');

  /*
      Common variables
    */

  // React hooks
  const navigate = useNavigate();
  const _location = useLocation();
  const abortUploadController = React.useRef<AbortController | null>(null);

  // EventSource refs for proper cleanup
  const singleFileEventSource = React.useRef<EventSource | null>(null);
  const modelImportEventSource = React.useRef<EventSource | null>(null);
  const multiFileEventSources = React.useRef<Map<string, EventSource>>(new Map());

  // Cleanup EventSources on component unmount
  React.useEffect(() => {
    // Capture ref values for cleanup (React requires this pattern to avoid stale refs in cleanup)
    const currentMultiFileSources = multiFileEventSources.current;

    return () => {
      // Close single file upload EventSource if open
      if (singleFileEventSource.current) {
        singleFileEventSource.current.close();
        singleFileEventSource.current = null;
      }
      // Close model import EventSource if open
      if (modelImportEventSource.current) {
        modelImportEventSource.current.close();
        modelImportEventSource.current = null;
      }
      // Close all multi-file EventSources
      currentMultiFileSources.forEach((eventSource) => {
        eventSource.close();
      });
      currentMultiFileSources.clear();
    };
  }, []);

  // Limit the number of concurrent file uploads or transfers
  const [maxConcurrentTransfers, setMaxConcurrentTransfers] = React.useState(2);
  const [maxFilesPerPage, setMaxFilesPerPage] = React.useState(DEFAULT_PAGE_SIZE);
  const [configuredMax, setConfiguredMax] = React.useState(DEFAULT_PAGE_SIZE);

  React.useEffect(() => {
    apiClient
      .get(`/settings/max-concurrent-transfers`)
      .then((response) => {
        const { maxConcurrentTransfers } = response.data;
        if (maxConcurrentTransfers !== undefined) {
          setMaxConcurrentTransfers(maxConcurrentTransfers);
        }
      })
      .catch((error) => {
        console.error(error);
        // Fall back to default value
        setMaxConcurrentTransfers(2);
        notifyWarning(
          t('notifications.defaultSettings.title'),
          t('notifications.defaultSettings.maxConcurrentTransfers'),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount; t is stable

  React.useEffect(() => {
    apiClient
      .get(`/settings/max-files-per-page`)
      .then((response) => {
        const { maxFilesPerPage } = response.data;
        if (maxFilesPerPage !== undefined) {
          const snapped = snapToNearestPreset(maxFilesPerPage);
          setConfiguredMax(snapped);
          setMaxFilesPerPage(snapped);
        }
      })
      .catch((error) => {
        console.error(error);
        // Fall back to default value
        setMaxFilesPerPage(DEFAULT_PAGE_SIZE);
        setConfiguredMax(DEFAULT_PAGE_SIZE);
        notifyWarning(t('notifications.defaultSettings.title'), t('notifications.defaultSettings.maxFilesPerPage'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount; t is stable

  // Clamp maxFilesPerPage if it exceeds configuredMax (edge case safety)
  React.useEffect(() => {
    if (maxFilesPerPage > configuredMax) {
      setMaxFilesPerPage(configuredMax);
    }
  }, [configuredMax, maxFilesPerPage]);

  // URL parameters from /browse/:locationId/:path?
  //
  // ENCODING STRATEGY (see docs/architecture/frontend-architecture.md):
  // - locationId: NOT encoded (validated to URL-safe [a-z0-9-] on backend)
  // - path: Base64-encoded (can contain slashes, spaces, special chars)
  const { locationId, path: encodedPath } = useParams<{
    locationId?: string;
    path?: string;
  }>();

  // Decode base64-encoded path from URL
  // Path is base64-encoded in URL to handle slashes and special characters safely
  // Note: locationId is NOT decoded - it's already URL-safe by validation
  // storageService will re-encode paths for local storage API calls
  const path = React.useMemo(() => {
    if (!encodedPath) return '';
    try {
      return base64Decode(encodedPath);
    } catch (error) {
      console.error('[StorageBrowser] Failed to decode path from URL:', encodedPath, error);
      return '';
    }
  }, [encodedPath]);

  // Unified storage locations (S3 + local)
  const [locations, setLocations] = React.useState<StorageLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = React.useState<boolean>(true);
  const [selectedLocation, setSelectedLocation] = React.useState<StorageLocation | null>(null);
  const [formSelectLocation, setFormSelectLocation] = React.useState(locationId || '');

  // Insert server search states early to avoid use-before-declaration
  const [searchObjectText, setSearchObjectText] = React.useState('');
  const [searchMode, setSearchMode] = React.useState<'startsWith' | 'contains'>('contains');
  const [filterMeta, setFilterMeta] = React.useState<{ truncated?: boolean } | null>(null);
  const serverSearchActive = searchObjectText.length >= 3;

  // Component-specific abort controller
  const abortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      // Cleanup: abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Load all storage locations (S3 + local) on mount
  // Note: StorageRouteGuard handles the "no locations" notification and redirect
  React.useEffect(() => {
    setLocationsLoading(true);
    storageService
      .getLocations()
      .then((result) => {
        const { locations: allLocations } = result;
        setLocations(allLocations);
        setLocationsLoading(false);
      })
      .catch((error) => {
        // This should not happen with allSettled, but keep as safety net
        console.error('[StorageBrowser] Failed to load storage locations:', error);
        setLocationsLoading(false);
        notifyWarning(t('notifications.errorLoadingLocations.title'), t('notifications.errorLoadingLocations.message'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount; t is stable

  // Set selected location based on URL parameter
  React.useEffect(() => {
    if (!locationId) {
      // No location selected - redirect to first available
      if (locations.length > 0) {
        const firstAvailable = locations.find((loc) => loc.available) || locations[0];
        navigate(`/browse/${firstAvailable.id}`);
      }
      return;
    }

    if (locations.length === 0) {
      // Locations not loaded yet
      return;
    }

    // Find location by ID
    const location = locations.find((loc) => loc.id === locationId);

    if (!location) {
      // Location not found
      console.error('[StorageBrowser] Location not found:', locationId);
      notifyWarning(
        t('notifications.locationNotFound.title'),
        t('notifications.locationNotFound.message', { locationId }),
      );
      // Redirect to first available location
      const firstAvailable = locations.find((loc) => loc.available) || locations[0];
      if (firstAvailable) {
        navigate(`/browse/${firstAvailable.id}`);
      } else {
        navigate('/browse');
      }
      return;
    }

    if (!location.available) {
      // Location exists but is unavailable
      console.warn('[StorageBrowser] Location unavailable:', locationId);
      notifyWarning(
        t('notifications.locationUnavailable.title'),
        t('notifications.locationUnavailable.message', { name: location.name }),
      );
    }

    // Set selected location
    setSelectedLocation(location);
    setFormSelectLocation(locationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, locations, navigate]); // t is stable and doesn't need to trigger re-runs

  // Handle location change in the dropdown
  const handleLocationSelectorChange = (_event: React.FormEvent<HTMLSelectElement>, value: string) => {
    // Find the selected location
    const newLocation = locations.find((loc) => loc.id === value);

    if (!newLocation) {
      console.error('[StorageBrowser] Selected location not found:', value);
      return;
    }

    if (!newLocation.available) {
      console.warn('[StorageBrowser] Attempted to select unavailable location:', value);
      notifyWarning(
        t('notifications.locationUnavailable.title'),
        t('notifications.locationUnavailable.cannotSelect', { name: newLocation.name }),
      );
      return;
    }

    // Navigate to the new location (root path)
    setFormSelectLocation(value);
    setSearchObjectText(''); // Clear search field when switching locations

    // Clear stale file/directory state to prevent showing old location's content
    // This prevents flash of incorrect content during location switch
    setDirectories([]);
    setFiles([]);
    setCurrentPath('');

    navigate(`/browse/${value}`);
  };

  const handleLocationTextInputSend = (_event: React.MouseEvent<HTMLButtonElement>) => {
    // Validate location exists
    const location = locations.find((loc) => loc.id === formSelectLocation);

    if (!location) {
      notifyWarning(
        t('notifications.invalidLocation.title'),
        t('notifications.invalidLocation.message', { locationId: formSelectLocation }),
      );
      return;
    }

    setSearchObjectText(''); // Clear search field when navigating to different location
    navigate(`/browse/${formSelectLocation}`);
  };

  /*
      Utilities
    */
  // Copy the prefix (aka full "folder" path) to the clipboard
  const copyPrefixToClipboard = () => {
    navigator.clipboard.writeText('/' + currentPath).then(
      () => {
        notifySuccess(t('notifications.pathCopied.title'), t('notifications.pathCopied.message'));
      },
      (err) => {
        console.error('Failed to copy prefix to clipboard: ', err);
      },
    );
  };

  /*
      Objects display
    */
  // Pagination state
  const [currentPath, setCurrentPath] = React.useState('');
  const [files, setFiles] = React.useState<FileEntry[]>([]);
  const [directories, setDirectories] = React.useState<FileEntry[]>([]);
  const [paginationToken, setPaginationToken] = React.useState<string | null>(null);
  const [_paginationOffset, setPaginationOffset] = React.useState(0);
  const paginationOffsetRef = React.useRef(0);
  const [isTruncated, setIsTruncated] = React.useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState<boolean>(false);
  const [isInitialLoading, setIsInitialLoading] = React.useState<boolean>(true);
  // Deep search (auto-pagination) state (disabled when serverSearchActive)
  const [deepSearchActive, setDeepSearchActive] = React.useState<boolean>(false);
  const [deepSearchPagesScanned, setDeepSearchPagesScanned] = React.useState<number>(0);
  const [deepSearchCancelled, setDeepSearchCancelled] = React.useState<boolean>(false);

  // Unified file refresh function - replaces refreshObjects
  const refreshFiles = React.useCallback(
    async (
      location: StorageLocation,
      path: string,
      continuationToken?: string | null,
      appendResults: boolean = false,
      searchParams?: { q: string; mode: 'startsWith' | 'contains' },
      _abortController?: AbortController,
    ): Promise<void> => {
      if (!location) {
        console.warn('[refreshFiles] No location provided');
        return;
      }

      try {
        let response;

        if (location.type === 's3') {
          // S3: Use continuation token pagination
          response = await storageService.listFiles(location.id, path, {
            continuationToken: continuationToken || undefined,
            maxKeys: searchParams ? undefined : maxFilesPerPage,
            q: searchParams?.q,
            mode: searchParams?.mode,
          });

          // Update S3 pagination state
          setPaginationToken(response.nextContinuationToken || null);
          setIsTruncated(response.isTruncated || false);
        } else {
          // Local storage: Use offset pagination
          const offset = appendResults ? paginationOffsetRef.current : 0;

          response = await storageService.listFiles(location.id, path, {
            limit: maxFilesPerPage,
            offset,
            q: searchParams?.q,
            mode: searchParams?.mode,
          });

          // Update local pagination state
          const hasMore = response.totalCount! > offset + response.files.length;
          setIsTruncated(hasMore);

          // Update offset for next page (ref + state)
          const newOffset = appendResults ? offset + response.files.length : response.files.length;
          paginationOffsetRef.current = newOffset;
          setPaginationOffset(newOffset);
        }

        // Separate files and directories from FileEntry array
        const dirEntries = response.files.filter((f) => f.type === 'directory');
        const fileEntries = response.files.filter((f) => f.type === 'file');

        if (appendResults) {
          // Append to existing results (pagination)
          setDirectories((prev) => [...prev, ...dirEntries]);
          setFiles((prev) => [...prev, ...fileEntries]);
        } else {
          // Replace results (new path or refresh)
          setDirectories(dirEntries);
          setFiles(fileEntries);
          // Mark initial loading complete (only for non-pagination loads)
          setIsInitialLoading(false);
        }

        setCurrentPath(path);
      } catch (error: unknown) {
        const err = error as { name?: string; response?: { data?: { message?: string } } };
        if (err.name === 'AbortError' || err.name === 'CanceledError') {
          return;
        }

        console.error('[refreshFiles] Failed:', error);
        notifyWarning(
          t('notifications.errorLoadingFiles.title'),
          err.response?.data?.message || t('notifications.errorLoadingFiles.message'),
        );

        // Clear results on error
        setDirectories([]);
        setFiles([]);
        setIsInitialLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxFilesPerPage],
  ); // Dependencies: maxFilesPerPage only; paginationOffset tracked via ref to avoid infinite loop; t is stable

  // Load files when location or path changes
  React.useEffect(() => {
    if (!selectedLocation) {
      return;
    }

    // Safety check: Prevent loading files if location doesn't match URL
    // This prevents race conditions when switching locations
    if (selectedLocation.id !== locationId) {
      return;
    }

    if (!selectedLocation.available) {
      console.warn('[StorageBrowser] Location unavailable, showing empty view');
      setDirectories([]);
      setFiles([]);
      return;
    }

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Reset pagination
    setPaginationToken(null);
    paginationOffsetRef.current = 0;
    setPaginationOffset(0);
    setIsTruncated(false);

    // Load files
    refreshFiles(
      selectedLocation,
      path || '',
      null,
      false,
      serverSearchActive ? { q: searchObjectText, mode: searchMode } : undefined,
      abortControllerRef.current || undefined,
    );
    // Note: searchMode, searchObjectText, serverSearchActive are intentionally excluded
    // as search behavior is handled by a dedicated effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation, path, locationId, refreshFiles]);

  React.useEffect(() => {
    // On short searches (<3) just local filter; if we were previously server searching, reload unfiltered list.
    if (!locationId) return;
    let cancelled = false;
    if (!serverSearchActive) {
      if (filterMeta) {
        // We were in server mode, need to reset to baseline listing
        setFilterMeta(null);
        setPaginationToken(null);
        setIsTruncated(false);
        if (selectedLocation && selectedLocation.available) {
          refreshFiles(selectedLocation, path || '', null, false, undefined, abortControllerRef.current || undefined);
        }
      }
      return;
    }
    // For server searches: debounce input
    const handle = setTimeout(() => {
      if (cancelled) return;
      // Reset pagination & existing results, then fetch filtered first page
      setPaginationToken(null);
      paginationOffsetRef.current = 0;
      setPaginationOffset(0);
      setIsTruncated(false);
      setFiles([]);
      setDirectories([]);
      setFilterMeta(null);
      if (selectedLocation && selectedLocation.available) {
        refreshFiles(
          selectedLocation,
          path || '',
          null,
          false,
          { q: searchObjectText, mode: searchMode },
          abortControllerRef.current || undefined,
        );
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchObjectText, searchMode, selectedLocation, path, refreshFiles, filterMeta, locationId, serverSearchActive]);

  const columnNames = {
    key: t('table.columns.key'),
    lastModified: t('table.columns.lastModified'),
    size: t('table.columns.size'),
  };

  // Filter files by name and path
  const filteredFiles = files.filter(
    (file) =>
      file.name.toLowerCase().includes(searchObjectText.toLowerCase()) ||
      file.path.toLowerCase().includes(searchObjectText.toLowerCase()),
  );

  // Filter directories by name and path
  const filteredDirectories = directories.filter(
    (dir) =>
      dir.name.toLowerCase().includes(searchObjectText.toLowerCase()) ||
      dir.path.toLowerCase().includes(searchObjectText.toLowerCase()),
  );

  // Sorting state
  const [activeSortIndex, setActiveSortIndex] = React.useState<number | null>(null);
  const [activeSortDirection, setActiveSortDirection] = React.useState<'asc' | 'desc' | null>(null);

  // Get sortable values for directories and files
  const getSortableRowValues = (item: FileEntry): (string | number)[] => {
    // Convert Date to timestamp for sorting
    const modifiedValue = item.modified ? item.modified.getTime() : 0;
    return [item.name, modifiedValue, item.size || 0];
  };

  // Sort directories
  const sortedDirectories = React.useMemo(() => {
    if (activeSortIndex === null) return filteredDirectories;
    return [...filteredDirectories].sort((a, b) => {
      const aValue = getSortableRowValues(a)[activeSortIndex];
      const bValue = getSortableRowValues(b)[activeSortIndex];
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return activeSortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      const aStr = String(aValue);
      const bStr = String(bValue);
      return activeSortDirection === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filteredDirectories, activeSortIndex, activeSortDirection]);

  // Sort files
  const sortedFiles = React.useMemo(() => {
    if (activeSortIndex === null) return filteredFiles;
    return [...filteredFiles].sort((a, b) => {
      const aValue = getSortableRowValues(a)[activeSortIndex];
      const bValue = getSortableRowValues(b)[activeSortIndex];
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return activeSortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      const aStr = String(aValue);
      const bStr = String(bValue);
      return activeSortDirection === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filteredFiles, activeSortIndex, activeSortDirection]);

  // Sort params helper
  const getSortParams = (columnIndex: number): ThProps['sort'] => ({
    sortBy: {
      index: activeSortIndex as number,
      direction: activeSortDirection as 'asc' | 'desc',
      defaultDirection: 'asc',
    },
    onSort: (_event, index, direction) => {
      setActiveSortIndex(index);
      setActiveSortDirection(direction);
    },
    columnIndex,
  });

  /*
      Multi-select state and handlers
    */
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = React.useState<string | null>(null);
  const [focusedRowIndex, setFocusedRowIndex] = React.useState<number | null>(null);

  // Combined list of all items for keyboard navigation (directories first, then files)
  const allItems = React.useMemo(() => {
    return [...sortedDirectories, ...sortedFiles];
  }, [sortedDirectories, sortedFiles]);

  // Clear selection and focus on navigation
  React.useEffect(() => {
    setSelectedItems(new Set());
    setLastSelected(null);
    setFocusedRowIndex(null);
  }, [currentPath, locationId]);

  // Create item map for efficient selection count calculation (O(1) lookup vs O(n²))
  const itemMap = React.useMemo(() => {
    const map = new Map<string, FileEntry>();
    filteredDirectories.forEach((item) => map.set(item.path, item));
    filteredFiles.forEach((item) => map.set(item.path, item));
    return map;
  }, [filteredDirectories, filteredFiles]);

  // Calculate selection counts efficiently using the item map
  const { selectedFileCount, selectedFolderCount } = React.useMemo(() => {
    let files = 0,
      folders = 0;
    selectedItems.forEach((itemPath) => {
      const item = itemMap.get(itemPath);
      if (item?.type === 'directory') folders++;
      else if (item?.type === 'file') files++;
    });
    return { selectedFileCount: files, selectedFolderCount: folders };
  }, [selectedItems, itemMap]);
  // Navigate when clicking on a path (directory)
  const handlePathClick = (newPath: string) => (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) event.preventDefault();

    // Don't navigate if already at this path
    if (currentPath === newPath) {
      return;
    }

    // Clear current results
    setFiles([]);
    setDirectories([]);
    setCurrentPath(newPath);

    // Reset pagination
    setPaginationToken(null);
    paginationOffsetRef.current = 0;
    setPaginationOffset(0);
    setIsTruncated(false);

    // Clear search
    setSearchObjectText('');

    // Navigate
    navigate(newPath !== '' ? `/browse/${locationId}/${base64Encode(newPath)}` : `/browse/${locationId}`);
  };

  // Select all visible items
  const handleSelectAll = React.useCallback(
    (isSelecting: boolean) => {
      if (isSelecting) {
        const allVisibleItems = new Set([
          ...filteredFiles.map((f) => f.path),
          ...filteredDirectories.map((d) => d.path),
        ]);
        setSelectedItems(allVisibleItems);
      } else {
        setSelectedItems(new Set());
      }
    },
    [filteredFiles, filteredDirectories],
  );

  // Single row selection
  const handleSelectRow = React.useCallback((path: string, isSelected: boolean) => {
    setSelectedItems((prev) => {
      const updated = new Set(prev);
      if (isSelected) {
        updated.add(path);
      } else {
        updated.delete(path);
      }
      return updated;
    });
    setLastSelected(path);
  }, []);

  // Shift+Click range selection
  const handleShiftClick = (path: string) => {
    if (!lastSelected) {
      handleSelectRow(path, true);
      return;
    }

    // Combine filtered directories and files for range selection
    const allFilteredItems = [...filteredDirectories, ...filteredFiles];

    const lastIndex = allFilteredItems.findIndex((f) => f.path === lastSelected);
    const currentIndex = allFilteredItems.findIndex((f) => f.path === path);

    if (lastIndex === -1 || currentIndex === -1) return;

    const start = Math.min(lastIndex, currentIndex);
    const end = Math.max(lastIndex, currentIndex);

    const updated = new Set(selectedItems);
    for (let i = start; i <= end; i++) {
      updated.add(allFilteredItems[i].path);
    }

    setSelectedItems(updated);
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle arrow keys when focus is within the table or on table rows
      const activeElement = document.activeElement;
      const isInTable = activeElement?.closest('table') !== null;
      const isTableRow = activeElement?.tagName === 'TR';
      const isInteractiveElement =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'SELECT' ||
        activeElement?.getAttribute('contenteditable') === 'true';

      // Ctrl+A: Select all
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        handleSelectAll(true);
      }

      // Escape: Clear selection and focus
      if (e.key === 'Escape') {
        setSelectedItems(new Set());
        setFocusedRowIndex(null);
      }

      // Arrow key navigation (only when not in an interactive element)
      if (!isInteractiveElement && allItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedRowIndex((prev) => {
            if (prev === null) return 0;
            return Math.min(prev + 1, allItems.length - 1);
          });
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedRowIndex((prev) => {
            if (prev === null) return allItems.length - 1;
            return Math.max(prev - 1, 0);
          });
        }

        // Space: Toggle selection of focused row (only when row is focused)
        if (e.key === ' ' && (isInTable || isTableRow) && focusedRowIndex !== null) {
          e.preventDefault();
          const focusedItem = allItems[focusedRowIndex];
          if (focusedItem) {
            const isSelected = selectedItems.has(focusedItem.path);
            handleSelectRow(focusedItem.path, !isSelected);
          }
        }

        // Home: Jump to first row
        if (e.key === 'Home' && (isInTable || isTableRow)) {
          e.preventDefault();
          setFocusedRowIndex(0);
        }

        // End: Jump to last row
        if (e.key === 'End' && (isInTable || isTableRow)) {
          e.preventDefault();
          setFocusedRowIndex(allItems.length - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectAll, allItems, focusedRowIndex, selectedItems, handleSelectRow]);

  // Ref to store row elements for focusing
  const rowRefs = React.useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Focus row when focusedRowIndex changes
  React.useEffect(() => {
    if (focusedRowIndex !== null) {
      const rowElement = rowRefs.current.get(focusedRowIndex);
      if (rowElement) {
        rowElement.focus();
      }
    }
  }, [focusedRowIndex]);

  // Bulk delete selected items - open confirmation modal
  const handleDeleteSelected = () => {
    setIsDeleteSelectedModalOpen(true);
  };

  // Bulk delete confirmation - actual deletion logic
  const handleDeleteSelectedConfirm = async () => {
    setIsDeletingSelected(true);
    try {
      await Promise.all(Array.from(selectedItems).map((path) => storageService.deleteFile(locationId!, path)));

      // Refresh file list
      if (selectedLocation && selectedLocation.available) {
        await refreshFiles(
          selectedLocation,
          path || '',
          null,
          false,
          undefined,
          abortControllerRef.current || undefined,
        );
      }
      setSelectedItems(new Set());

      notifySuccess(t('delete.selected.success'), t('delete.selected.successMessage', { count: selectedItems.size }));

      setIsDeleteSelectedModalOpen(false);
    } catch (error) {
      console.error('Failed to delete selected items:', error);
      notifyWarning(t('notifications.deleteFailed.title'), t('notifications.deleteFailed.message'));
    } finally {
      setIsDeletingSelected(false);
    }
  };

  // Open transfer modal for selected items
  const handleCopySelected = () => {
    if (selectedItems.size === 0) {
      notifyWarning(t('notifications.noItemsSelected.title'), t('notifications.noItemsSelected.message'));
      return;
    }
    setIsTransferModalOpen(true);
  };

  // Helper to validate which files can be viewed
  const validateFileView = (filename: string, size: number) => {
    const allowedExtensions = [
      'txt',
      'log',
      'jpg',
      'py',
      'json',
      'yaml',
      'yml',
      'md',
      'html',
      'css',
      'js',
      'ts',
      'tsx',
      'jsx',
      'sh',
      'bash',
      'sql',
      'csv',
      'xml',
      'png',
      'gif',
      'bmp',
      'jpeg',
      'svg',
      'webp',
      'ico',
    ];
    if (size > 1024 * 1024) {
      return false;
    }
    if (!allowedExtensions.includes(filename.split('.').pop() || '')) {
      return false;
    }
    return true;
  };

  /*
      File viewing
    */
  const [fileData, setFileData] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [viewingFile, setViewingFile] = React.useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = React.useState<string | null>(null);

  const [isFileViewerOpen, setIsFileViewerOpen] = React.useState(false);
  const handleFileViewerToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsFileViewerOpen(!isFileViewerOpen);
  };

  const handleObjectViewClick = (key: string) => async (_event: React.MouseEvent<HTMLButtonElement>) => {
    // Retrieve the object from the backend and open the File Viewer modal
    setViewingFile(key);
    try {
      const response = await apiClient.get(`/objects/view/${locationId}/${base64Encode(key)}`, {
        responseType: 'arraybuffer',
      });
      setFileName(key.split('/').pop() || '');
      const binary = new Uint8Array(response.data);
      const data = btoa(binary.reduce((data, byte) => data + String.fromCharCode(byte), ''));
      setFileData(data);
      setIsFileViewerOpen(true);
    } catch (error: unknown) {
      console.error('Error viewing object', error);
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      notifyWarning(
        err.response?.data?.error || t('fileViewer.error'),
        err.response?.data?.message || t('fileViewer.errorObjectMessage'),
      );
    } finally {
      setViewingFile(null);
    }
  };

  const handleLocalFileViewClick = (filePath: string) => async (_event: React.MouseEvent<HTMLButtonElement>) => {
    // Retrieve the local file from the backend and open the File Viewer modal
    setViewingFile(filePath);
    try {
      const response = await apiClient.get(`/local/view/${locationId}/${base64Encode(filePath)}`, {
        responseType: 'arraybuffer',
      });
      setFileName(filePath.split('/').pop() || '');
      const binary = new Uint8Array(response.data);
      const data = btoa(binary.reduce((data, byte) => data + String.fromCharCode(byte), ''));
      setFileData(data);
      setIsFileViewerOpen(true);
    } catch (error: unknown) {
      console.error('Error viewing local file', error);
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      notifyWarning(
        err.response?.data?.error || t('fileViewer.error'),
        err.response?.data?.message || t('fileViewer.errorMessage'),
      );
    } finally {
      setViewingFile(null);
    }
  };

  // Download file handler - avoids page navigation issues
  const handleFileDownload = async (file: FileEntry) => {
    if (!selectedLocation || !locationId) {
      console.error('[Download] No location selected');
      return;
    }

    setDownloadingFile(file.path);

    // Build download path based on storage type
    const downloadPath =
      selectedLocation.type === 's3'
        ? `/objects/download/${locationId}/${base64Encode(file.path)}`
        : `/local/download/${locationId}/${base64Encode(file.path)}`;

    try {
      // Use apiClient to ensure correct backend URL and auth headers
      const response = await apiClient.get(downloadPath, { responseType: 'blob' });
      const blob = response.data as Blob;

      // Create a download link from the blob
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[Download] Error:', error);
      notifyWarning(t('notifications.downloadFailed.title'), t('notifications.downloadFailed.message'));
    } finally {
      setDownloadingFile(null);
    }
  };

  /*
      File(s) upload progress trackers
    */

  // We have 2 progress trackers: one for the upload to the backend and one for the upload to S3
  // They are stored in objects with the encoded key as key (yes, I know...) and the percentage as value
  interface UploadToS3Percentage {
    loaded: number;
    status?: string;
  }

  interface UploadToS3Percentages {
    [key: string]: UploadToS3Percentage;
  }

  interface UploadPercentage {
    loaded: number;
  }

  interface UploadPercentages {
    [key: string]: UploadPercentage;
  }

  const [uploadToS3Percentages, setUploadToS3Percentages] = React.useState<UploadToS3Percentages>({});
  const [uploadPercentages, setUploadPercentages] = React.useState<UploadPercentages>({});

  const updateS3Progress = (key: string, value: number, status: string = '') => {
    setUploadToS3Percentages((prevPercentages) => ({
      ...prevPercentages,
      [key]: {
        ...prevPercentages[key],
        loaded: value,
        status: status,
      },
    }));
  };

  const updateProgress = (encodedKey: string, loaded: number) => {
    setUploadPercentages((prevPercentages) => ({
      ...prevPercentages,
      [encodedKey]: {
        ...prevPercentages[encodedKey],
        loaded: loaded,
      },
    }));
  };

  /*
      Single file upload
    */
  const [singleFileUploadValue, setSingleFileUploadValue] = React.useState<File | undefined>(undefined); // File reference
  const [singleFilename, setSingleFilename] = React.useState(''); // Filename
  const [isUploadSingleFileModalOpen, setIsUploadSingleFileModalOpen] = React.useState(false);
  const handleUploadSingleFileModalToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsUploadSingleFileModalOpen(!isUploadSingleFileModalOpen);
  };

  const resetSingleFileUploadPanel = () => {
    setSingleFileUploadValue(undefined);
    setSingleFilename('');
    setUploadToS3Percentages({});
    setUploadPercentages({});
    setIsUploadSingleFileModalOpen(false);
    abortUploadController.current = null;
  };

  const handleFileInputChange = (_, file: File) => {
    setSingleFilename(file.name);
    setSingleFileUploadValue(file);
  };

  const handleUploadFileCancel = (_event: React.MouseEvent) => {
    if (abortUploadController.current) {
      abortUploadController.current.abort(); // Abort the current request if controller exists
    }
    apiClient
      .get(`/objects/abort-upload`, {})
      .then(() => {
        // Upload aborted successfully
      })
      .catch((error) => {
        console.error('Error aborting upload', error);
        notifyWarning(
          error.response?.data?.error || t('upload.abortError'),
          error.response?.data?.message || t('upload.abortErrorMessage'),
        );
      });
    resetSingleFileUploadPanel();
  };

  const handleUploadFileConfirm = (_event: React.MouseEvent) => {
    if (!singleFileUploadValue || !selectedLocation || !locationId) {
      return;
    }
    const fileSize = singleFileUploadValue.size;
    // Ensure proper path joining with separator
    const fullPath = currentPath
      ? currentPath.endsWith('/')
        ? currentPath + singleFilename
        : currentPath + '/' + singleFilename
      : singleFilename;

    // Reset progress trackers
    setUploadPercentages(() => ({
      [singleFilename]: { loaded: 0 },
    }));
    setUploadToS3Percentages(() => ({
      [singleFilename]: { loaded: 0 },
    }));

    // Upload to storage progress feedback (backend-side progress)
    // Use one-time ticket for SSE authentication
    const encodedKey = base64Encode(fullPath);
    createAuthenticatedEventSource(encodedKey, 'upload')
      .then((eventSource) => {
        singleFileEventSource.current = eventSource;

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.loaded !== 0 && data.status === 'uploading') {
            updateS3Progress(singleFilename, Math.round((data.loaded / fileSize) * 100));
          }
          if (data.status === 'completed') {
            eventSource.close();
            singleFileEventSource.current = null;
            delete uploadToS3Percentages[singleFilename];
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          singleFileEventSource.current = null;
        };
      })
      .catch((error) => {
        console.error('[StorageBrowser] Failed to create upload progress SSE:', error);
        // Continue with upload even if SSE fails
      });

    // Upload using storageService with progress callback
    // Note: storageService handles base64 encoding internally for local storage
    storageService
      .uploadFile(locationId, fullPath, singleFileUploadValue, {
        onProgress: (percentCompleted) => {
          updateProgress(singleFilename, percentCompleted);
        },
      })
      .then(() => {
        const oldFileName = singleFilename;
        notifySuccess(t('upload.success'), t('upload.successMessage', { fileName: oldFileName }));
        resetSingleFileUploadPanel();
        if (selectedLocation && selectedLocation.available) {
          refreshFiles(
            selectedLocation,
            currentPath,
            paginationToken,
            false,
            undefined,
            abortControllerRef.current || undefined,
          );
        }
      })
      .catch((error) => {
        console.error('Error uploading file', error);
        notifyWarning(
          error.response?.data?.error || t('upload.failed'),
          error.response?.data?.message || String(error),
        );
        resetSingleFileUploadPanel();
      });
  };

  const handleClear = (_event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    setSingleFilename('');
    setSingleFileUploadValue(undefined);
  };

  /*
      Multiple files upload
    */

  const [currentFiles, setCurrentFiles] = React.useState<ExtendedFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFile[]>([]);
  const [showStatus, setShowStatus] = React.useState(false);
  const [statusIcon, setStatusIcon] = React.useState('inProgress');

  const [isUploadFilesModalOpen, setIsUploadFilesModalOpen] = React.useState(false);

  const handleUploadFilesModalToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsUploadFilesModalOpen(!isUploadFilesModalOpen);
  };

  const handleUploadFilesClose = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsUploadFilesModalOpen(false);
    setCurrentFiles([]);
    setUploadedFiles([]);
    setUploadToS3Percentages({});
    setUploadPercentages({});
    setShowStatus(false);

    // Refresh file browser to show newly uploaded files
    if (selectedLocation && selectedLocation.available) {
      refreshFiles(
        selectedLocation,
        currentPath,
        paginationToken,
        false,
        undefined,
        abortControllerRef.current || undefined,
      );
    }
  };

  if (!showStatus && currentFiles.length > 0) {
    setShowStatus(true);
  }

  // determine the icon that should be shown for the overall status list
  React.useEffect(() => {
    if (uploadedFiles.length < currentFiles.length) {
      setStatusIcon('inProgress');
    } else if (uploadedFiles.every((file) => file.loadResult === 'success')) {
      setStatusIcon('success');
    } else {
      setStatusIcon('danger');
    }
  }, [uploadedFiles, currentFiles]);

  // Show notification when all uploads are complete
  React.useEffect(() => {
    if (currentFiles.length === 0 || !isUploadFilesModalOpen) return;

    const allCompleted = uploadedFiles.length === currentFiles.length;
    if (!allCompleted) return;

    const allSuccessful = uploadedFiles.every((file) => file.loadResult === 'success');
    const successCount = uploadedFiles.filter((file) => file.loadResult === 'success').length;
    const failureCount = uploadedFiles.length - successCount;

    if (allSuccessful) {
      notifySuccess(
        t('notifications.uploadComplete.title'),
        t('notifications.uploadComplete.message', { count: successCount }),
      );
    } else if (failureCount > 0) {
      notifyWarning(
        t('notifications.uploadPartialFailed.title'),
        t('notifications.uploadPartialFailed.message', { failed: failureCount, total: successCount + failureCount }),
      );
    }

    // Refresh file list to show newly uploaded files/folders
    if (selectedLocation && selectedLocation.available) {
      refreshFiles(selectedLocation, currentPath, null, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedFiles, currentFiles, isUploadFilesModalOpen, selectedLocation, currentPath, refreshFiles]); // t is stable

  // remove files from both state arrays based on their paths
  const removeFiles = (pathsOfFilesToRemove: string[]) => {
    const newCurrentFiles = currentFiles.filter(
      (currentFile) => !pathsOfFilesToRemove.some((path) => path === currentFile.path),
    );

    setCurrentFiles(newCurrentFiles);

    const newUploadedFiles = uploadedFiles.filter(
      (uploadedFile) => !pathsOfFilesToRemove.some((path) => path === uploadedFile.path),
    );

    setUploadedFiles(newUploadedFiles);
  };

  const updateCurrentFiles = (files: ExtendedFile[]): void => {
    setCurrentFiles((prevFiles) => [...prevFiles, ...files]);
  };

  const handleFileDrop = async (_event: DropEvent, droppedFiles: File[]) => {
    // Cast to ExtendedFile type and process paths to remove eventual leading "./"
    // Type for files with optional path property (from drag-drop or file input)
    // Note: webkitRelativePath is already on File interface
    type FileWithPath = File & { path?: string };
    const fullDroppedFiles: ExtendedFile[] = droppedFiles.map((originalFile) => {
      // 1. Determine the path for the file.
      // Prefer webkitRelativePath for dropped folders, then an existing .path, fallback to file.name.
      let pathValue: string;
      const fileWithPath = originalFile as FileWithPath;
      const webkitPath = fileWithPath.webkitRelativePath;
      const directPath = fileWithPath.path;

      if (typeof webkitPath === 'string' && webkitPath.trim() !== '') {
        pathValue = webkitPath;
      } else if (typeof directPath === 'string' && directPath.trim() !== '') {
        pathValue = directPath;
      } else {
        pathValue = originalFile.name;
      }

      // Process the path remove leading "./"
      let processedPath = pathValue.startsWith('./') ? pathValue.substring(2) : pathValue;
      if (!processedPath && originalFile.name) {
        // Ensure path is not empty
        processedPath = originalFile.name;
      }

      // 2. Create a new File object from the original file's content and metadata.
      // This ensures it's a proper File instance that FormData can handle.
      const newFileInstance = new File(
        [originalFile], // The content of the new file is the original file itself
        originalFile.name, // Use the original file's name for the File object's name property
        {
          type: originalFile.type,
          lastModified: originalFile.lastModified,
        },
      );

      // 3. Cast the new File instance to ExtendedFile and add custom properties.
      const extendedFile = newFileInstance as ExtendedFile;

      // Define 'path' as an own, writable property on the new File instance.
      Object.defineProperty(extendedFile, 'path', {
        value: processedPath, // Store the processed path here
        writable: true,
        enumerable: true,
        configurable: true,
      });

      // Add other custom properties
      extendedFile.uploadProgress = 0;
      extendedFile.uploadS3Progress = 0;

      return extendedFile;
    });
    // identify what, if any, files are re-uploads of already uploaded files
    // filtering on full path in case multiple folders gave the same file
    const currentFilePaths = currentFiles.map((file) => file.path);
    const reUploads = fullDroppedFiles.filter((fullDroppedFiles) => currentFilePaths.includes(fullDroppedFiles.path));

    /** this promise chain is needed because if the file removal is done at the same time as the file adding react
     * won't realize that the status items for the re-uploaded files needs to be re-rendered */
    Promise.resolve()
      .then(() => removeFiles(reUploads.map((file) => file.path)))
      .then(() => updateCurrentFiles(fullDroppedFiles));

    // Add the new files to the progress trackers
    setUploadPercentages((prevPercentages) => {
      const newPercentages = { ...prevPercentages };
      for (const file of fullDroppedFiles) {
        const filePath = file.path.replace(/^\//, '');
        const fullPath = currentPath
          ? currentPath.endsWith('/')
            ? currentPath + filePath
            : currentPath + '/' + filePath
          : filePath;
        newPercentages[fullPath] = { loaded: 0 };
      }
      return newPercentages;
    });

    setUploadToS3Percentages((prevPercentages) => {
      const newPercentages = { ...prevPercentages };
      for (const file of fullDroppedFiles) {
        const filePath = file.path.replace(/^\//, '');
        const fullPath = currentPath
          ? currentPath.endsWith('/')
            ? currentPath + filePath
            : currentPath + '/' + filePath
          : filePath;
        newPercentages[fullPath] = { loaded: 0, status: 'queued' };
      }
      return newPercentages;
    });

    // Start the upload process, using limit to control the number of concurrent uploads
    const limit = pLimit(maxConcurrentTransfers);

    const promises = fullDroppedFiles.map((file: ExtendedFile) => limit(() => handleFileUpload(file)));

    await Promise.all(promises);
  };

  // Processes a file upload
  const handleFileUpload = async (file: File): Promise<void> => {
    if (!locationId || !selectedLocation) {
      console.error('[Upload] No location selected');
      return;
    }

    const fullFile = file as ExtendedFile;
    const filePath = fullFile.path.replace(/^\//, '').replace(/^\.\//, ''); // remove leading slash in case of folder upload or ./ in case of files
    // Ensure proper path joining with separator
    const fullPath = currentPath
      ? currentPath.endsWith('/')
        ? currentPath + filePath
        : currentPath + '/' + filePath
      : filePath;

    if (uploadPercentages[fullPath]) {
      // File already in upload progress, skipping
      return;
    }

    const fileSize = fullFile.size;

    // Upload to storage progress feedback (backend-side progress)
    // Use one-time ticket for SSE authentication
    const encodedKey = base64Encode(fullPath);
    createAuthenticatedEventSource(encodedKey, 'upload')
      .then((eventSource) => {
        multiFileEventSources.current.set(fullPath, eventSource);

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.loaded !== 0 && data.status === 'uploading') {
            updateS3Progress(fullPath, Math.round((data.loaded / fileSize) * 100), data.status);
          }
          if (data.status === 'completed') {
            updateS3Progress(fullPath, 100, data.status);
            // Close and remove this specific EventSource
            eventSource.close();
            multiFileEventSources.current.delete(fullPath);
            setUploadedFiles((prevUploadedFiles) => {
              const fileExists = prevUploadedFiles.some(
                (file) => file.path === fullFile.path && file.loadResult === 'success',
              );
              if (!fileExists) {
                return [...prevUploadedFiles, { fileName: fullFile.name, loadResult: 'success', path: fullFile.path }];
              }
              return prevUploadedFiles;
            });
            // Note: File list will be refreshed after all uploads complete
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          multiFileEventSources.current.delete(fullPath);
        };
      })
      .catch((error) => {
        console.error('[StorageBrowser] Failed to create upload progress SSE:', error);
        // Continue with upload even if SSE fails
      });

    // Upload using storageService with progress callback
    // Note: storageService handles base64 encoding internally for local storage
    await storageService
      .uploadFile(locationId, fullPath, file, {
        onProgress: (percentCompleted) => {
          updateProgress(fullPath, percentCompleted);
        },
      })
      .then(() => {
        // Track success for local/PVC uploads (EventSource doesn't fire completion for local storage)
        if (selectedLocation?.type === 'local') {
          setUploadedFiles((prevUploadedFiles) => {
            const fileExists = prevUploadedFiles.some((f) => f.path === fullFile.path && f.loadResult === 'success');
            if (!fileExists) {
              return [...prevUploadedFiles, { fileName: fullFile.name, loadResult: 'success', path: fullFile.path }];
            }
            return prevUploadedFiles;
          });

          // Note: File list will be refreshed after all uploads complete
        }
      })
      .catch((error) => {
        console.error('Error uploading file', error);
        notifyWarning(
          error.response?.data?.error || t('upload.failed'),
          error.response?.data?.message || String(error),
        );
        setUploadedFiles((prevUploadedFiles) => [
          ...prevUploadedFiles,
          { loadError: error, fileName: fullFile.name, loadResult: 'danger', path: fullPath },
        ]);
      });
  };

  // add helper text to a status item showing any error encountered during the file reading process
  const createHelperText = (file: File) => {
    const fullFile = file as ExtendedFile;
    const fileResult = uploadedFiles.find((uploadedFile) => uploadedFile.path === fullFile.path);
    if (fileResult?.loadError) {
      return (
        <HelperText isLiveRegion>
          <HelperTextItem variant={'error'}>{fileResult.loadError.toString()}</HelperTextItem>
        </HelperText>
      );
    }
    return null; // Explicitly return null when there's no error
  };

  const [successfullyUploadedFileCount, setSuccessfullyUploadedFileCount] = React.useState(0);

  React.useEffect(() => {
    const successCount = uploadedFiles.filter((uploadedFile) => uploadedFile.loadResult === 'success').length;
    setSuccessfullyUploadedFileCount(successCount);
  }, [uploadedFiles]);

  /*
      File deletion
    */
  const [isDeleteFileModalOpen, setIsDeleteFileModalOpen] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState('');
  const [fileToDelete, setFileToDelete] = React.useState('');
  const [isDeletingFile, setIsDeletingFile] = React.useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = React.useState(false);
  const [isDeleteSelectedModalOpen, setIsDeleteSelectedModalOpen] = React.useState(false);
  const [bulkDeleteConfirmed, setBulkDeleteConfirmed] = React.useState(false);

  // Reset bulk delete confirmation checkbox when modal opens/closes
  React.useEffect(() => {
    if (!isDeleteSelectedModalOpen) {
      setBulkDeleteConfirmed(false);
    }
  }, [isDeleteSelectedModalOpen]);

  const handleDeleteFileModalToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsDeleteFileModalOpen(!isDeleteFileModalOpen);
  };

  const handleDeleteFileClick = (key: string) => (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    setSelectedFile(key);
    handleDeleteFileModalToggle(event);
  };

  const validateFileToDelete = (): boolean => {
    if (fileToDelete !== selectedFile.split('/').pop()) {
      return false;
    } else {
      return true;
    }
  };

  const handleDeleteFileConfirm = async () => {
    if (!validateFileToDelete()) {
      return;
    }
    if (!selectedFile) return;

    setIsDeletingFile(true);
    try {
      await storageService.deleteFile(locationId!, selectedFile);

      notifySuccess(
        t('delete.file.success'),
        t('delete.file.successMessage', { fileName: selectedFile.split('/').pop() }),
      );

      setFileToDelete('');
      setIsDeleteFileModalOpen(false);
      if (selectedLocation && selectedLocation.available) {
        refreshFiles(
          selectedLocation,
          currentPath,
          paginationToken,
          false,
          undefined,
          abortControllerRef.current || undefined,
        );
      }
    } catch (error: unknown) {
      console.error('Error deleting file', error);
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      notifyWarning(err.response?.data?.error || t('delete.file.failed'), err.response?.data?.message || String(error));
    } finally {
      setIsDeletingFile(false);
    }
  };

  const handleDeleteFileCancel = () => {
    setFileToDelete('');
    setIsDeleteFileModalOpen(false);
    setIsDeletingFile(false);
  };

  /*
      Folder deletion
    */
  const [isDeleteFolderModalOpen, setIsDeleteFolderModalOpen] = React.useState(false);
  const [selectedFolder, setSelectedFolder] = React.useState('');
  const [folderToDelete, setFolderToDelete] = React.useState('');
  const [isDeletingFolder, setIsDeletingFolder] = React.useState(false);

  /*
      File details modal state
    */
  const [isFileDetailsModalOpen, setIsFileDetailsModalOpen] = React.useState(false);
  const [selectedFileForDetails, setSelectedFileForDetails] = React.useState<string>('');

  const handleFileDetailsClick = (filePath: string) => (_event: React.MouseEvent<HTMLButtonElement>) => {
    setSelectedFileForDetails(filePath);
    setIsFileDetailsModalOpen(true);
  };

  const handleFileDetailsClose = () => {
    setIsFileDetailsModalOpen(false);
    setSelectedFileForDetails('');
  };

  const handleDeleteFolderModalToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsDeleteFolderModalOpen(!isDeleteFolderModalOpen);
  };

  const handleDeleteFolderClick = (prefix: string) => (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    setSelectedFolder(prefix);
    handleDeleteFolderModalToggle(event);
  };

  const validateFolderToDelete = (): boolean => {
    if (folderToDelete !== selectedFolder.replace(/\/$/, '').split('/').pop()) {
      return false;
    } else {
      return true;
    }
  };

  const handleDeleteFolderConfirm = async () => {
    if (!validateFolderToDelete()) {
      return;
    }

    setIsDeletingFolder(true);
    try {
      await storageService.deleteFile(locationId!, selectedFolder);

      notifySuccess(
        t('delete.folder.success'),
        t('delete.folder.successMessage', { folderName: selectedFolder.replace(/\/$/, '').split('/').pop() }),
      );

      setFolderToDelete('');
      setIsDeleteFolderModalOpen(false);
      if (selectedLocation && selectedLocation.available) {
        refreshFiles(
          selectedLocation,
          currentPath,
          paginationToken,
          false,
          undefined,
          abortControllerRef.current || undefined,
        );
      }
    } catch (error: unknown) {
      console.error('Error deleting folder', error);
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      notifyWarning(
        err.response?.data?.error || t('delete.folder.failed'),
        err.response?.data?.message || String(error),
      );
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const handleDeleteFolderCancel = () => {
    setFolderToDelete('');
    setIsDeleteFolderModalOpen(false);
    setIsDeletingFolder(false);
  };

  /*
      Folder creation
    */
  const [newFolderName, setNewFolderName] = React.useState('');
  const [newFolderNameRulesVisibility, setNewFolderNameRulesVisibility] = React.useState(false);

  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = React.useState(false);
  const handleCreateFolderModalToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsCreateFolderModalOpen(!isCreateFolderModalOpen);
  };

  // Validate folder name using centralized validation utility
  const validateFolderName = (folderName: string, storageType?: 's3' | 'local'): boolean => {
    return validateS3ObjectName(folderName, storageType);
  };

  React.useEffect(() => {
    if (newFolderName.length > 0) {
      setNewFolderNameRulesVisibility(!validateFolderName(newFolderName, selectedLocation?.type));
    } else {
      setNewFolderNameRulesVisibility(false);
    }
  }, [newFolderName, selectedLocation?.type]);

  const handleNewFolderCreate = async () => {
    if (!validateFolderName(newFolderName, selectedLocation?.type)) {
      return;
    }

    try {
      // Properly join path with separator to avoid concatenating folder names
      const newPath = currentPath
        ? currentPath.endsWith('/')
          ? currentPath + newFolderName
          : currentPath + '/' + newFolderName
        : newFolderName;
      await storageService.createDirectory(locationId!, newPath);

      notifySuccess(t('createFolder.success'), t('createFolder.successMessage', { folderName: newFolderName }));

      setNewFolderName('');
      setIsCreateFolderModalOpen(false);
      if (selectedLocation && selectedLocation.available) {
        refreshFiles(
          selectedLocation,
          currentPath,
          paginationToken,
          false,
          undefined,
          abortControllerRef.current || undefined,
        );
      }
    } catch (error: unknown) {
      console.error('Error creating folder', error);
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      notifyWarning(
        err.response?.data?.error || t('createFolder.failed'),
        err.response?.data?.message || String(error),
      );
    }
  };

  const handleNewFolderCancel = () => {
    setNewFolderName('');
    setIsCreateFolderModalOpen(false);
  };

  // Import HF model handling
  const [modelName, setModelName] = React.useState('');
  const [isImportModelModalOpen, setIsImportModelModalOpen] = React.useState(false);
  const [modelFiles, setModelFiles] = React.useState<string[]>([]);
  const [currentImportJobId, setCurrentImportJobId] = React.useState<string | null>(null);
  const [showCleanupDialog, setShowCleanupDialog] = React.useState(false);

  // Type for cancelled job info (from transfer API)
  interface CancelledJobFile {
    destinationPath: string;
    status: string;
  }
  interface CancelledJobInfo {
    files?: CancelledJobFile[];
  }
  const [cancelledJobInfo, setCancelledJobInfo] = React.useState<CancelledJobInfo | null>(null);
  const [isDeletingFiles, setIsDeletingFiles] = React.useState(false);

  const handleImportModelModalToggle = (_event: KeyboardEvent | React.MouseEvent) => {
    setIsImportModelModalOpen(!isImportModelModalOpen);
  };

  const handleImportModelClose = (_event: React.MouseEvent) => {
    setIsImportModelModalOpen(false);
    setModelName('');
    setModelFiles([]);
    setUploadToS3Percentages({});
  };

  // Load locations when modal opens
  React.useEffect(() => {
    if (isImportModelModalOpen) {
      storageService
        .getLocations()
        .then((result) => {
          const { locations: allLocations } = result;
          setLocations(allLocations);

          // Notify if no locations available
          if (allLocations.length === 0) {
            notifyWarning(t('notifications.noLocations.title'), t('notifications.modelImport.noLocations'));
          }
        })
        .catch((error) => {
          console.error('Failed to load storage locations:', error);
          notifyWarning(
            t('notifications.errorLoadingLocations.title'),
            t('notifications.errorLoadingLocations.message'),
          );
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImportModelModalOpen]); // t is stable

  // Form validation for HF import
  const isHfFormValid = () => {
    return modelName.trim() !== '';
  };

  // Transfer modal state
  const [isTransferModalOpen, setIsTransferModalOpen] = React.useState(false);

  const handleImportModelConfirm = async (_event: React.MouseEvent) => {
    try {
      // Use current path as-is; backend will append the full modelId
      const destinationPath = currentPath || '';

      // Type for progress data from SSE
      interface ProgressFileData {
        file: string;
        loaded?: number;
        total?: number;
        status?: string;
        error?: string;
      }

      interface ProgressData {
        error?: string;
        status?: string;
        files?: ProgressFileData[];
      }

      interface HuggingFaceImportParams {
        modelId: string;
        destinationType: 's3' | 'local';
        bucketName?: string;
        prefix?: string;
        localLocationId?: string;
        localPath?: string;
      }

      const params: HuggingFaceImportParams = {
        modelId: modelName,
        destinationType: selectedLocation?.type || 's3',
      };

      if (selectedLocation?.type === 's3') {
        params.bucketName = locationId;
        params.prefix = destinationPath;
      } else {
        params.localLocationId = locationId;
        params.localPath = destinationPath;
      }

      const response = await apiClient.post(`/objects/huggingface-import`, params);
      const _sseUrl = `${config.backend_api_url}${response.data.sseUrl}`;
      const jobId = response.data.jobId;

      // Store job ID for cancellation
      setCurrentImportJobId(jobId);

      let reconnectAttempts = 0;
      const maxReconnectAttempts = 5;

      const connectToProgressStream = () => {
        // Close existing EventSource if any
        if (modelImportEventSource.current) {
          modelImportEventSource.current.close();
        }

        // Set up SSE for progress tracking with new transfer queue format
        // Use one-time ticket for SSE authentication
        createAuthenticatedEventSource(jobId, 'transfer')
          .then((eventSource) => {
            modelImportEventSource.current = eventSource;

            eventSource.onmessage = (event) => {
              const data: ProgressData = JSON.parse(event.data);

              // Handle error in job data
              if (data.error) {
                console.error('Job error:', data.error);
                notifyWarning(t('notifications.modelImport.error'), data.error);
                eventSource.close();
                modelImportEventSource.current = null;
                return;
              }

              // New format: { jobId, status, progress, files: [{file, loaded, total, status, error}] }
              const { status: jobStatus, files } = data;

              // Initialize modelFiles array with file names if empty
              if (files && modelFiles.length === 0) {
                // Extract just the filename from destination path for display
                setModelFiles(
                  files.map((f: ProgressFileData) => {
                    const destPath = f.file;
                    // destPath format: "s3:bucket/path/filename" or "local:loc/path/filename"
                    return destPath.split('/').pop() || destPath;
                  }),
                );
              }

              // Update progress for each file
              if (files) {
                files.forEach((fileData: ProgressFileData) => {
                  const { file: destPath, loaded, total, status: fileStatus, error } = fileData;

                  // Extract filename from destination path for progress key
                  const fileName = destPath.split('/').pop() || destPath;

                  if (error) {
                    // Don't show notifications for user-initiated cancellations
                    if (error !== 'Cancelled by user') {
                      notifyWarning(
                        t('notifications.modelImport.error'),
                        t('notifications.modelImport.fileError', { fileName, error }),
                      );
                    }
                    return;
                  }

                  if (loaded !== undefined && total !== undefined && total > 0) {
                    const percentage = Math.round((loaded / total) * 100);
                    updateS3Progress(fileName, percentage, fileStatus || 'downloading');
                  }
                });
              }

              // Check if job completed
              if (jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'cancelled') {
                eventSource.close();
                modelImportEventSource.current = null;

                if (jobStatus === 'completed') {
                  // Clear job ID
                  setCurrentImportJobId(null);

                  notifySuccess(
                    t('notifications.modelImport.success'),
                    t('notifications.modelImport.successMessage', { modelName }),
                  );
                  handleImportModelClose(_event);
                  // Refresh file browser to show imported model
                  if (selectedLocation && selectedLocation.available) {
                    refreshFiles(
                      selectedLocation,
                      currentPath,
                      null,
                      false,
                      undefined,
                      abortControllerRef.current || undefined,
                    );
                  }
                } else if (jobStatus === 'failed') {
                  // Clear job ID
                  setCurrentImportJobId(null);

                  notifyWarning(
                    t('notifications.modelImport.failed'),
                    t('notifications.modelImport.failedMessage', { modelName }),
                  );
                } else if (jobStatus === 'cancelled') {
                  // Job was cancelled - don't clear jobId yet as we might need it for cleanup
                  // It will be cleared after user makes cleanup decision
                  notifyInfo(
                    t('notifications.modelImport.cancelled'),
                    t('notifications.modelImport.cancelledMessage', { modelName }),
                  );
                }
              }
            };

            eventSource.onerror = () => {
              eventSource.close();
              modelImportEventSource.current = null;

              // Check if all files completed successfully before attempting reconnection
              const allCompleted =
                modelFiles.length > 0 &&
                modelFiles.every((file) => {
                  return uploadToS3Percentages[file]?.status === 'completed';
                });

              if (allCompleted) {
                // All files completed, no need to show error or reconnect
                return;
              }

              // Attempt to reconnect with exponential backoff
              if (reconnectAttempts < maxReconnectAttempts) {
                const backoffDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                reconnectAttempts++;

                setTimeout(() => {
                  connectToProgressStream();
                }, backoffDelay);
              } else {
                // Max reconnection attempts reached
                notifyWarning(t('notifications.connectionError.title'), t('notifications.connectionError.lost'));
              }
            };
          })
          .catch((error) => {
            console.error('[StorageBrowser] Failed to create HuggingFace import SSE:', error);
            notifyError(
              t('notifications.connectionError.title'),
              error.message || t('notifications.connectionError.message'),
            );
          });
      };

      // Start the initial connection
      connectToProgressStream();

      notifySuccess(
        t('notifications.modelImport.started'),
        t('notifications.modelImport.startedMessage', { modelName }),
      );
    } catch (error: unknown) {
      console.error('HuggingFace import failed:', error);
      const err = error as { response?: { data?: { message?: string } } };
      notifyWarning(
        t('notifications.modelImport.failed'),
        err.response?.data?.message || t('notifications.modelImport.startFailed'),
      );
    }
  };

  const handleCancelImport = async () => {
    if (!currentImportJobId) {
      console.warn('No active import job to cancel');
      return;
    }

    try {
      // Cancel the job via API
      await apiClient.delete(`/transfer/${currentImportJobId}`);

      // Close EventSource
      if (modelImportEventSource.current) {
        modelImportEventSource.current.close();
        modelImportEventSource.current = null;
      }

      // Fetch job details to show user what was downloaded
      const jobInfoResponse = await apiClient.get(`/transfer/${currentImportJobId}`);
      setCancelledJobInfo(jobInfoResponse.data);
      setShowCleanupDialog(true);
    } catch (error: unknown) {
      console.error('Failed to cancel import:', error);
      const err = error as { response?: { data?: { message?: string } } };
      notifyWarning(
        t('notifications.modelImport.cancelFailed'),
        err.response?.data?.message || t('notifications.modelImport.cancelFailedMessage'),
      );
    }
  };

  const handleCleanupDecision = async (shouldDelete: boolean) => {
    if (!shouldDelete || !cancelledJobInfo) {
      // User chose to keep files - refresh to show them
      if (selectedLocation && selectedLocation.available) {
        refreshFiles(selectedLocation, currentPath, null, false, undefined, abortControllerRef.current || undefined);
      }
      setShowCleanupDialog(false);
      setCancelledJobInfo(null);
      setCurrentImportJobId(null);
      handleImportModelClose({} as React.MouseEvent);
      return;
    }

    // User chose to delete - call cleanup endpoint
    setIsDeletingFiles(true);
    try {
      await apiClient.post(`/transfer/${currentImportJobId}/cleanup`);

      notifySuccess(t('notifications.filesDeleted.title'), t('notifications.filesDeleted.message'));

      // Refresh file browser
      if (selectedLocation && selectedLocation.available) {
        refreshFiles(selectedLocation, currentPath, null, false, undefined, abortControllerRef.current || undefined);
      }
    } catch (error: unknown) {
      console.error('Failed to cleanup files:', error);
      const err = error as { response?: { data?: { message?: string } } };
      notifyWarning(
        t('notifications.cleanupFailed.title'),
        err.response?.data?.message || t('notifications.cleanupFailed.message'),
      );
    } finally {
      setIsDeletingFiles(false);
      setShowCleanupDialog(false);
      setCancelledJobInfo(null);
      setCurrentImportJobId(null);
      handleImportModelClose({} as React.MouseEvent);
    }
  };

  const handleLoadMore = React.useCallback(() => {
    if (!isTruncated || isLoadingMore || deepSearchActive || !selectedLocation) {
      return;
    }

    setIsLoadingMore(true);

    if (selectedLocation.type === 's3') {
      // S3: Use continuation token
      refreshFiles(
        selectedLocation,
        currentPath,
        paginationToken,
        true, // append results
        serverSearchActive ? { q: searchObjectText, mode: searchMode } : undefined,
        abortControllerRef.current || undefined,
      ).finally(() => setIsLoadingMore(false));
    } else {
      // Local: Use offset (already tracked in state)
      refreshFiles(
        selectedLocation,
        currentPath,
        null,
        true, // append results
        undefined,
        abortControllerRef.current || undefined,
      ).finally(() => setIsLoadingMore(false));
    }
  }, [
    isTruncated,
    isLoadingMore,
    deepSearchActive,
    selectedLocation,
    refreshFiles,
    currentPath,
    paginationToken,
    serverSearchActive,
    searchObjectText,
    searchMode,
  ]);

  // Deep search: auto paginate until we find matches for current searchObjectText (or exhaust pages)
  const initiateDeepSearch = React.useCallback(async () => {
    if (serverSearchActive) return; // server handled; disable client deep search
    if (deepSearchActive || !isTruncated || !paginationToken) return;
    setDeepSearchActive(true);
    setDeepSearchPagesScanned(0);
    setDeepSearchCancelled(false);
    try {
      let pages = 0;
      // Loop while more pages and still no matches and not cancelled
      // Recompute filtered arrays after each append; rely on derived variables after state settles
      while (!deepSearchCancelled) {
        // Re-evaluate current matches
        const haveMatches = filteredFiles.length + filteredDirectories.length > 0;
        if (haveMatches) break;
        if (!isTruncated || !paginationToken) break;
        if (selectedLocation && selectedLocation.available) {
          await refreshFiles(
            selectedLocation,
            path || '',
            paginationToken,
            true,
            undefined,
            abortControllerRef.current || undefined,
          );
        }
        pages += 1;
        setDeepSearchPagesScanned(pages);
        // Yield to allow state to update
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      setDeepSearchActive(false);
    }
  }, [
    serverSearchActive,
    deepSearchActive,
    isTruncated,
    paginationToken,
    deepSearchCancelled,
    filteredFiles.length,
    filteredDirectories.length,
    selectedLocation,
    refreshFiles,
    path,
  ]);

  const cancelDeepSearch = () => {
    setDeepSearchCancelled(true);
    setDeepSearchActive(false);
  };

  // Auto-trigger deep search for client-side searches when no matches found
  React.useEffect(() => {
    if (!locationId || deepSearchActive) return;
    if (searchObjectText.length === 0) return; // No search active
    if (!isTruncated || !paginationToken) return; // No more pages

    // Check if we have any matches in current data
    const hasMatches = filteredFiles.length + filteredDirectories.length > 0;
    if (hasMatches) return; // Already have matches

    // For server search, check if we need to auto-load more pages
    // This handles cases where server search returns empty first page but might have results later
    if (serverSearchActive) {
      // For server search with no results, auto-trigger loading more pages after a delay
      const timer = setTimeout(() => {
        if (isTruncated && paginationToken && !isLoadingMore) {
          handleLoadMore();
        }
      }, 1500); // Slightly longer delay for server search

      return () => clearTimeout(timer);
    } else {
      // For client-side search, trigger deep search as before
      const timer = setTimeout(() => {
        initiateDeepSearch();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [
    searchObjectText,
    filteredFiles.length,
    filteredDirectories.length,
    isTruncated,
    paginationToken,
    serverSearchActive,
    deepSearchActive,
    locationId,
    isLoadingMore,
    handleLoadMore,
    initiateDeepSearch,
  ]);

  // Map items to mobile card format
  const mobileCardItems: MobileCardItem[] = React.useMemo(() => {
    const dirCards: MobileCardItem[] = sortedDirectories.map((dir) => ({
      id: dir.path,
      title: dir.name,
      icon: <FolderIcon className="folder-icon" />,
      label: {
        text: 'Folder',
        color: 'blue' as const,
      },
      fields: [
        {
          label: t('table.columns.lastModified'),
          value: dir.modified ? new Date(dir.modified).toLocaleString() : '-',
        },
      ],
      actions: (
        <Tooltip content={<div>{t('tooltips.deleteFolder')}</div>}>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteFolderClick(dir.path)}
            aria-label={`Delete folder ${dir.name}`}
          >
            <TrashIcon />
          </Button>
        </Tooltip>
      ),
      selectable: true,
      isSelected: selectedItems.has(dir.path),
      onSelect: (isSelected: boolean) => handleSelectRow(dir.path, isSelected),
      onClick: () => handlePathClick(dir.path)(),
    }));

    const fileCards: MobileCardItem[] = sortedFiles.map((file) => ({
      id: file.path,
      title: file.name,
      icon: <FileIcon className="file-icon" />,
      fields: [
        {
          label: t('table.columns.size'),
          value: file.size ? formatBytes(file.size) : '-',
        },
        {
          label: t('table.columns.lastModified'),
          value: file.modified ? new Date(file.modified).toLocaleString() : '-',
        },
      ],
      actions: (
        <Flex gap={{ default: 'gapSm' }}>
          <FlexItem>
            <Button
              variant="primary"
              size="sm"
              isDisabled={!validateFileView(file.name, file.size || 0) || viewingFile === file.path}
              isLoading={viewingFile === file.path}
              onClick={
                selectedLocation?.type === 'local'
                  ? handleLocalFileViewClick(file.path)
                  : handleObjectViewClick(file.path)
              }
              aria-label={`View file ${file.name}`}
            >
              {viewingFile !== file.path && <EyeIcon />}
            </Button>
          </FlexItem>
          <FlexItem>
            <Button
              variant="primary"
              size="sm"
              isLoading={downloadingFile === file.path}
              isDisabled={downloadingFile === file.path}
              onClick={() => handleFileDownload(file)}
              aria-label={`Download file ${file.name}`}
            >
              {downloadingFile !== file.path && <DownloadIcon />}
            </Button>
          </FlexItem>
          {selectedLocation?.type === 's3' && (
            <FlexItem>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleFileDetailsClick(file.path)}
                aria-label={`View details for ${file.name}`}
              >
                <InfoCircleIcon />
              </Button>
            </FlexItem>
          )}
          <FlexItem>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteFileClick(file.path)}
              aria-label={`Delete file ${file.name}`}
            >
              <TrashIcon />
            </Button>
          </FlexItem>
        </Flex>
      ),
      selectable: true,
      isSelected: selectedItems.has(file.path),
      onSelect: (isSelected: boolean) => handleSelectRow(file.path, isSelected),
    }));

    return [...dirCards, ...fileCards];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable callbacks, wrapping in useCallback would be a larger refactor
  }, [sortedDirectories, sortedFiles, selectedItems, viewingFile, downloadingFile, selectedLocation?.type]);

  return (
    <div>
      <PageSection hasBodyWrapper={false}>
        <Content component={ContentVariants.h1}>{t('title')}</Content>
      </PageSection>
      {selectedLocation && !selectedLocation.available && (
        <PageSection hasBodyWrapper={false}>
          <Alert variant="warning" title={t('alerts.locationUnavailable.title')} isInline>
            <p>
              {t('alerts.locationUnavailable.message', { name: selectedLocation.name })}
              {selectedLocation.type === 'local' && <span> {t('alerts.locationUnavailable.localMessage')}</span>}
            </p>
            <p>{t('alerts.locationUnavailable.disabledMessage')}</p>
          </Alert>
        </PageSection>
      )}
      <PageSection hasBodyWrapper={false} isFilled={true} className="storage-browser-page-section">
        <Flex direction={{ default: 'row' }}>
          <FlexItem>
            <Flex>
              <FlexItem>
                <Content component={ContentVariants.p}>{t('locationSelector.label')}</Content>
              </FlexItem>
              <FlexItem>
                <div className="pf-u-flex-align-center pf-u-flex-gap-sm">
                  <FormSelect
                    className="bucket-select"
                    value={formSelectLocation}
                    aria-label={t('locationSelector.placeholder')}
                    ouiaId="BasicFormSelect"
                    onChange={handleLocationSelectorChange}
                    isDisabled={locationsLoading}
                  >
                    {locationsLoading ? (
                      <FormSelectOption key="loading" value="" label={t('locationSelector.loading')} isDisabled />
                    ) : locations.length === 0 ? (
                      <FormSelectOption key="empty" value="" label={t('locationSelector.noLocations')} isDisabled />
                    ) : null}

                    {locations.map((loc) => {
                      const label =
                        loc.type === 's3'
                          ? `${loc.name} ${t('locationSelector.typeS3')}`
                          : `${loc.name} ${t('locationSelector.typePVC')}${!loc.available ? t('locationSelector.unavailableSuffix') : ''}`;

                      return <FormSelectOption key={loc.id} value={loc.id} label={label} isDisabled={!loc.available} />;
                    })}
                  </FormSelect>
                  {locationsLoading && <Spinner size="sm" aria-label="Loading storage locations" />}
                </div>
              </FlexItem>
            </Flex>
          </FlexItem>
          {selectedLocation?.type === 's3' && (
            <FlexItem>
              <Flex>
                <FlexItem>
                  <Content component={ContentVariants.p}>{t('locationSelector.overrideLabel')}</Content>
                </FlexItem>
                <FlexItem>
                  <TextInput
                    value={formSelectLocation}
                    onChange={(_event, value) => setFormSelectLocation(value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleLocationTextInputSend(event as unknown as React.MouseEvent<HTMLButtonElement>);
                      }
                    }}
                    type="search"
                    aria-label={t('locationSelector.overridePlaceholder')}
                    placeholder={t('locationSelector.overridePlaceholder')}
                    className="buckets-list-filter-search"
                  />
                </FlexItem>
                <FlexItem>
                  <Button variant="secondary" onClick={handleLocationTextInputSend} ouiaId="RefreshBucket">
                    {t('locationSelector.setLocation')}
                  </Button>
                </FlexItem>
              </Flex>
            </FlexItem>
          )}
        </Flex>
      </PageSection>
      <PageSection hasBodyWrapper={false} isFilled={true}>
        <Flex>
          <FlexItem>
            <Breadcrumb ouiaId="PrefixBreadcrumb">
              <BreadcrumbItem to={`/browse/${locationId}`}>
                <Button
                  variant="link"
                  className="breadcrumb-button"
                  onClick={handlePathClick('')}
                  aria-label="location-name"
                >
                  {selectedLocation?.name || locationId}
                </Button>
              </BreadcrumbItem>
              {(currentPath.endsWith('/') ? currentPath.slice(0, -1) : currentPath)
                .split('/')
                .filter((part) => part) // Remove empty strings from split
                .map((part, index, pathParts) => (
                  <BreadcrumbItem key={index}>
                    <Button
                      variant="link"
                      className="breadcrumb-button"
                      onClick={handlePathClick(pathParts.slice(0, index + 1).join('/') + '/')}
                      isDisabled={index === pathParts.length - 1}
                      aria-label="folder-name"
                    >
                      {part}
                    </Button>
                  </BreadcrumbItem>
                ))}
            </Breadcrumb>
          </FlexItem>
          <FlexItem>
            <Button variant="secondary" onClick={copyPrefixToClipboard} className="copy-path-button" ouiaId="CopyPath">
              {t('actions.copyPath')}
            </Button>
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection hasBodyWrapper={false} isFilled={true}>
        <Flex direction={{ default: 'column' }}>
          <FlexItem>
            <Flex>
              <FlexItem className="pf-u-max-width-300">
                <TextInput
                  value={searchObjectText}
                  type="search"
                  onChange={(_event, searchText) => setSearchObjectText(searchText)}
                  aria-label="search text input"
                  placeholder={t('search.filterPlaceholder')}
                  customIcon={<SearchIcon />}
                  className="buckets-list-filter-search"
                />
              </FlexItem>
              <FlexItem>
                <FormSelect
                  value={searchMode}
                  aria-label="Search mode"
                  onChange={(_e, v) => setSearchMode(v as 'startsWith' | 'contains')}
                  isDisabled={!serverSearchActive}
                  ouiaId="SearchModeSelect"
                >
                  <FormSelectOption value="contains" label={t('search.mode.contains')} />
                  <FormSelectOption value="startsWith" label={t('search.mode.startsWith')} />
                </FormSelect>
              </FlexItem>
              <FlexItem>
                <FormSelect
                  value={maxFilesPerPage.toString()}
                  aria-label="Files per page"
                  onChange={(_e, value) => {
                    const newValue = parseInt(value, 10);
                    setMaxFilesPerPage(newValue);
                    // Reset pagination and refresh files
                    setPaginationToken(null);
                    paginationOffsetRef.current = 0;
                    setPaginationOffset(0);
                    if (selectedLocation && selectedLocation.available) {
                      refreshFiles(
                        selectedLocation,
                        path || '',
                        null,
                        false,
                        serverSearchActive ? { q: searchObjectText, mode: searchMode } : undefined,
                        abortControllerRef.current || undefined,
                      );
                    }
                  }}
                  ouiaId="PageSizeSelect"
                  className="page-size-select"
                >
                  {getAvailablePageSizes(configuredMax).map((size) => (
                    <FormSelectOption key={size} value={size.toString()} label={size.toString()} />
                  ))}
                </FormSelect>
              </FlexItem>
              <FlexItem alignSelf={{ default: 'alignSelfCenter' }}>
                {tCommon('common.pagination.perPageLabel')}
              </FlexItem>
              {serverSearchActive && (
                <FlexItem>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearchObjectText('');
                    }}
                    ouiaId="ClearSearch"
                  >
                    {t('search.clear')}
                  </Button>
                </FlexItem>
              )}
              <FlexItem flex={{ default: 'flex_1' }}></FlexItem>
              <FlexItem>
                <Flex>
                  <FlexItem className="file-folder-buttons">
                    <Button variant="primary" onClick={handleCreateFolderModalToggle} ouiaId="ShowCreateFolderModal">
                      {t('actions.createFolder')}
                    </Button>
                  </FlexItem>
                  <FlexItem className="file-folder-buttons">
                    <Button
                      variant="primary"
                      onClick={handleUploadSingleFileModalToggle}
                      ouiaId="ShowUploadSingleFileModal"
                    >
                      {t('actions.uploadSingle')}
                    </Button>
                  </FlexItem>
                  <FlexItem className="file-folder-buttons">
                    <Button
                      variant="primary"
                      onClick={handleUploadFilesModalToggle}
                      ouiaId="ShowUploadMultipleFileModal"
                    >
                      {t('actions.uploadMultiple')}
                    </Button>
                  </FlexItem>
                  <FlexItem className="file-folder-buttons">
                    <Button
                      variant="primary"
                      onClick={handleImportModelModalToggle}
                      icon={<img className="button-logo" src={HfLogo} alt="HuggingFace Logo" />}
                      isDisabled={!selectedLocation || !locationId}
                      ouiaId="ShowImportHFModal"
                    >
                      {t('actions.importModel')}
                    </Button>
                  </FlexItem>
                </Flex>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            {selectedItems.size > 0 && (
              <Toolbar>
                <ToolbarContent>
                  <ToolbarItem>
                    <Content component={ContentVariants.p}>
                      {t('selection.filesAndFolders', { files: selectedFileCount, folders: selectedFolderCount })}
                    </Content>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button variant="primary" icon={<CopyIcon />} onClick={handleCopySelected}>
                      {t('actions.copyTo')}
                    </Button>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button
                      variant="danger"
                      icon={<TrashIcon />}
                      onClick={handleDeleteSelected}
                      isLoading={isDeletingSelected}
                      isDisabled={isDeletingSelected}
                    >
                      {tCommon('common.actions.delete')}
                    </Button>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button variant="link" onClick={() => setSelectedItems(new Set())}>
                      {t('actions.clearSelection')}
                    </Button>
                  </ToolbarItem>
                </ToolbarContent>
              </Toolbar>
            )}
            {isInitialLoading ? (
              <Card component="div">
                {/* Table view for loading (desktop) */}
                <div className="s4-table-view">
                  <ResponsiveTableWrapper ariaLabel="Loading files table">
                    <Table aria-label="Loading files" isStickyHeader>
                      <Thead>
                        <Tr>
                          <Th screenReaderText="Select" />
                          <Th width={30}>{columnNames.key}</Th>
                          <Th width={10} className="s4-hide-below-md">
                            {columnNames.lastModified}
                          </Th>
                          <Th width={10} className="s4-hide-below-sm">
                            {columnNames.size}
                          </Th>
                          <Th width={10} screenReaderText="Actions" />
                        </Tr>
                      </Thead>
                      <Tbody>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Tr key={i} className="bucket-row">
                            <Td className="bucket-column">
                              <Skeleton width="20px" screenreaderText="Loading checkbox" />
                            </Td>
                            <Td className="bucket-column">
                              <Skeleton width="60%" screenreaderText="Loading file name" />
                            </Td>
                            <Td className="bucket-column s4-hide-below-md">
                              <Skeleton width="100px" screenreaderText="Loading last modified" />
                            </Td>
                            <Td className="bucket-column s4-hide-below-sm">
                              <Skeleton width="60px" screenreaderText="Loading size" />
                            </Td>
                            <Td className="bucket-column align-right">
                              <Skeleton width="80px" screenreaderText="Loading actions" />
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </ResponsiveTableWrapper>
                </div>
                {/* Card view for loading (mobile) */}
                <div className="s4-card-view">
                  <MobileCardView items={[]} isLoading={true} skeletonCount={5} ariaLabel="Loading files" />
                </div>
              </Card>
            ) : filteredDirectories.length === 0 && filteredFiles.length === 0 && !searchObjectText ? (
              <Card component="div">
                <EmptyState icon={FolderOpenIcon} titleText={t('emptyState.folderEmpty')}>
                  <EmptyStateBody>{t('emptyState.folderEmptyDescription')}</EmptyStateBody>
                  <EmptyStateFooter>
                    <Button onClick={handleCreateFolderModalToggle}>{t('actions.createFolder')}</Button>
                    <Button variant="secondary" onClick={handleUploadFilesModalToggle}>
                      {t('actions.uploadFiles')}
                    </Button>
                  </EmptyStateFooter>
                </EmptyState>
              </Card>
            ) : filteredDirectories.length === 0 && filteredFiles.length === 0 && searchObjectText ? (
              <Card component="div">
                <EmptyState icon={SearchIcon} titleText={t('emptyState.noSearchResults')}>
                  <EmptyStateBody>
                    {t('emptyState.noSearchResultsDescription', { searchText: searchObjectText })}
                  </EmptyStateBody>
                  <EmptyStateFooter>
                    <Button variant="secondary" onClick={() => setSearchObjectText('')}>
                      {t('search.clear')}
                    </Button>
                  </EmptyStateFooter>
                </EmptyState>
              </Card>
            ) : (
              <Card component="div">
                {/* Table view (desktop) */}
                <div className="s4-table-view">
                  <ResponsiveTableWrapper ariaLabel="Files list table">
                    <Table aria-label="Files list" isStickyHeader>
                      <Thead>
                        <Tr>
                          <Th
                            screenReaderText="Select all"
                            select={{
                              onSelect: (_event, isSelecting) => handleSelectAll(isSelecting),
                              isSelected:
                                selectedItems.size > 0 &&
                                selectedItems.size === filteredFiles.length + filteredDirectories.length &&
                                filteredFiles.length + filteredDirectories.length > 0,
                            }}
                          />
                          <Th width={30} sort={getSortParams(0)}>
                            {columnNames.key}
                          </Th>
                          <Th width={10} sort={getSortParams(1)} className="s4-hide-below-md">
                            {columnNames.lastModified}
                          </Th>
                          <Th width={10} sort={getSortParams(2)} className="s4-hide-below-sm">
                            {columnNames.size}
                          </Th>
                          <Th width={10} screenReaderText="Actions" />
                        </Tr>
                      </Thead>
                      <Tbody>
                        {sortedDirectories.map((dir, rowIndex) => (
                          <Tr
                            key={dir.path}
                            className={`bucket-row${focusedRowIndex === rowIndex ? ' focused-row' : ''}`}
                            isRowSelected={selectedItems.has(dir.path)}
                            tabIndex={0}
                            ref={(el: HTMLTableRowElement | null) => {
                              if (el) {
                                rowRefs.current.set(rowIndex, el);
                              } else {
                                rowRefs.current.delete(rowIndex);
                              }
                            }}
                            onFocus={() => setFocusedRowIndex(rowIndex)}
                            onRowClick={(event) => {
                              if (event?.shiftKey) {
                                handleShiftClick(dir.path);
                              }
                            }}
                          >
                            <Td
                              select={{
                                rowIndex: rowIndex,
                                onSelect: (_event, isSelecting) => handleSelectRow(dir.path, isSelecting),
                                isSelected: selectedItems.has(dir.path),
                              }}
                            />
                            <Td className="bucket-column">
                              <Button variant="link" onClick={handlePathClick(dir.path)} className="button-folder-link">
                                <FolderIcon className="folder-icon" />
                                {dir.name}
                              </Button>
                            </Td>
                            <Td className="bucket-column s4-hide-below-md">
                              {dir.modified ? new Date(dir.modified).toLocaleString() : '-'}
                            </Td>
                            <Td className="bucket-column s4-hide-below-sm">-</Td>
                            <Td className="bucket-column align-right">
                              <Tooltip content={<div>{t('tooltips.deleteFolder')}</div>}>
                                <Button
                                  variant="danger"
                                  className="button-file-control"
                                  onClick={handleDeleteFolderClick(dir.path)}
                                  aria-label={`Delete folder ${dir.name}`}
                                >
                                  <TrashIcon />
                                </Button>
                              </Tooltip>
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                      <Tbody>
                        {sortedFiles.map((file, rowIndex) => {
                          // File rows come after directory rows in the combined allItems array
                          const combinedIndex = sortedDirectories.length + rowIndex;
                          return (
                            <Tr
                              key={file.path}
                              className={`bucket-row${focusedRowIndex === combinedIndex ? ' focused-row' : ''}`}
                              isRowSelected={selectedItems.has(file.path)}
                              tabIndex={0}
                              ref={(el: HTMLTableRowElement | null) => {
                                if (el) {
                                  rowRefs.current.set(combinedIndex, el);
                                } else {
                                  rowRefs.current.delete(combinedIndex);
                                }
                              }}
                              onFocus={() => setFocusedRowIndex(combinedIndex)}
                              onRowClick={(event) => {
                                if (event?.shiftKey) {
                                  handleShiftClick(file.path);
                                }
                              }}
                            >
                              <Td
                                select={{
                                  rowIndex: rowIndex,
                                  onSelect: (_event, isSelecting) => handleSelectRow(file.path, isSelecting),
                                  isSelected: selectedItems.has(file.path),
                                }}
                              />
                              <Td className="bucket-column">
                                <FileIcon className="file-icon" />
                                {file.name}
                              </Td>
                              <Td className="bucket-column s4-hide-below-md">
                                {file.modified ? new Date(file.modified).toLocaleString() : '-'}
                              </Td>
                              <Td className="bucket-column s4-hide-below-sm">
                                {file.size ? formatBytes(file.size) : '-'}
                              </Td>
                              <Td className="bucket-column align-right">
                                <ToolbarContent>
                                  <ToolbarGroup
                                    variant="action-group-plain"
                                    align={{ default: 'alignEnd' }}
                                    gap={{ default: 'gapMd', md: 'gapMd' }}
                                  >
                                    <ToolbarItem gap={{ default: 'gapLg' }}>
                                      <Tooltip content={<div>{t('tooltips.viewFile')}</div>}>
                                        <Button
                                          variant="primary"
                                          className="button-file-control"
                                          isDisabled={
                                            !validateFileView(file.name, file.size || 0) || viewingFile === file.path
                                          }
                                          isLoading={viewingFile === file.path}
                                          onClick={
                                            selectedLocation?.type === 'local'
                                              ? handleLocalFileViewClick(file.path)
                                              : handleObjectViewClick(file.path)
                                          }
                                          aria-label={`View file ${file.name}`}
                                        >
                                          {viewingFile !== file.path && <EyeIcon />}
                                        </Button>
                                      </Tooltip>
                                    </ToolbarItem>
                                    <ToolbarItem gap={{ default: 'gapLg' }}>
                                      <Tooltip content={<div>{t('tooltips.downloadFile')}</div>}>
                                        <Button
                                          variant="primary"
                                          className="button-file-control"
                                          isLoading={downloadingFile === file.path}
                                          isDisabled={downloadingFile === file.path}
                                          onClick={() => handleFileDownload(file)}
                                          aria-label={`Download file ${file.name}`}
                                        >
                                          {downloadingFile !== file.path && <DownloadIcon />}
                                        </Button>
                                      </Tooltip>
                                    </ToolbarItem>
                                    {selectedLocation?.type === 's3' && (
                                      <ToolbarItem gap={{ default: 'gapLg' }}>
                                        <Tooltip content={<div>{t('tooltips.viewDetails')}</div>}>
                                          <Button
                                            variant="secondary"
                                            className="button-file-control"
                                            onClick={handleFileDetailsClick(file.path)}
                                            aria-label={`View details for ${file.name}`}
                                          >
                                            <InfoCircleIcon />
                                          </Button>
                                        </Tooltip>
                                      </ToolbarItem>
                                    )}
                                    <ToolbarItem variant="separator" />
                                    <ToolbarItem>
                                      <Tooltip content={<div>{t('tooltips.deleteFile')}</div>}>
                                        <Button
                                          variant="danger"
                                          className="button-file-control"
                                          onClick={handleDeleteFileClick(file.path)}
                                          aria-label={`Delete file ${file.name}`}
                                        >
                                          <TrashIcon />
                                        </Button>
                                      </Tooltip>
                                    </ToolbarItem>
                                  </ToolbarGroup>
                                </ToolbarContent>
                              </Td>
                            </Tr>
                          );
                        })}
                      </Tbody>
                    </Table>
                  </ResponsiveTableWrapper>
                </div>
                {/* Card view (mobile) */}
                <div className="s4-card-view">
                  <MobileCardView items={mobileCardItems} ariaLabel="Files list" />
                </div>
              </Card>
            )}
            {/* Pagination Controls */}
            {isTruncated && !serverSearchActive && (
              <Flex direction={{ default: 'row' }} className="pf-u-margin-top-md">
                <FlexItem>
                  <Button
                    variant="secondary"
                    onClick={handleLoadMore}
                    isDisabled={isLoadingMore || deepSearchActive}
                    ouiaId="LoadMore"
                  >
                    {isLoadingMore
                      ? t('pagination.loading')
                      : `${t('pagination.loadMore')} (${paginationToken ? t('pagination.moreAvailable') : t('pagination.lastPage')})`}
                  </Button>
                </FlexItem>
              </Flex>
            )}
            {/* Deep Search UI */}
            {deepSearchActive && (
              <Flex direction={{ default: 'row' }} className="pf-u-margin-top-md">
                <FlexItem>
                  <Content component={ContentVariants.p}>
                    {t('search.deepSearchActive', { count: deepSearchPagesScanned })}
                  </Content>
                </FlexItem>
                <FlexItem>
                  <Button variant="secondary" onClick={cancelDeepSearch} ouiaId="CancelDeepSearch">
                    {t('search.cancel')}
                  </Button>
                </FlexItem>
              </Flex>
            )}
            {/* Server Search Messages */}
            {serverSearchActive && filterMeta && (
              <Flex direction={{ default: 'column' }} className="pf-u-margin-top-md">
                <FlexItem>
                  <Content component={ContentVariants.p}>
                    {t('search.partialResults')} {filterMeta.truncated ? t('search.moreResultsAvailable') : ''}
                  </Content>
                </FlexItem>
              </Flex>
            )}
            {!serverSearchActive && searchObjectText.length >= 3 && isTruncated && (
              <Flex direction={{ default: 'column' }} className="pf-u-margin-top-md">
                <FlexItem>
                  <Content component={ContentVariants.p}>{t('search.clientFiltering')}</Content>
                </FlexItem>
              </Flex>
            )}
            <Flex direction={{ default: 'column' }}>
              <FlexItem className="file-list-notes" align={{ default: 'alignRight' }}>
                <Content component={ContentVariants.small}>{t('notes.fileViewerLimit')}</Content>
              </FlexItem>
              <FlexItem className="file-list-notes" align={{ default: 'alignRight' }}>
                <Content component={ContentVariants.small}>{t('notes.lastItemDeletesFolder')}</Content>
              </FlexItem>
              <FlexItem className="file-list-notes" align={{ default: 'alignRight' }}>
                <Content component={ContentVariants.small}>{t('notes.largeDownloadWarning')}</Content>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>
      <Modal
        isOpen={isFileViewerOpen}
        onClose={handleFileViewerToggle}
        ouiaId="file-viewer-modal"
        className="file-viewer-modal"
        aria-labelledby="file-viewer-modal-title"
      >
        <ModalHeader labelId="file-viewer-modal-title" title={t('fileViewer.title')} />
        <ModalBody>
          <div className="file-viewer-wrapper">
            <DocumentRenderer fileData={fileData} fileName={fileName} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button key="close" variant="primary" onClick={handleFileViewerToggle}>
            {tCommon('common.actions.close')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isDeleteFileModalOpen}
        onClose={handleDeleteFileModalToggle}
        aria-labelledby="delete-file-modal-title"
      >
        <ModalHeader labelId="delete-file-modal-title" title={t('delete.file.title')} titleIconVariant="warning" />
        <ModalBody>
          <Content>
            <Content component={ContentVariants.p}>{t('delete.file.message')}</Content>
            <Content component={ContentVariants.p}>
              {t('delete.file.confirmMessage_prefix')} <strong>{selectedFile.split('/').pop()}</strong>{' '}
              {t('delete.file.confirmMessage_suffix')}
            </Content>
          </Content>
          <TextInput
            id="delete-modal-input"
            aria-label="Delete modal input"
            value={fileToDelete}
            onChange={(_event, fileToDelete) => setFileToDelete(fileToDelete)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (validateFileToDelete()) {
                  handleDeleteFileConfirm();
                }
              }
            }}
            validated={fileToDelete.length > 0 && !validateFileToDelete() ? 'error' : 'default'}
          />
        </ModalBody>
        <ModalFooter>
          <Button
            key="confirm"
            variant="danger"
            onClick={handleDeleteFileConfirm}
            isDisabled={!validateFileToDelete() || isDeletingFile}
            isLoading={isDeletingFile}
          >
            {t('delete.file.confirm')}
          </Button>
          <Button key="cancel" variant="secondary" onClick={handleDeleteFileCancel}>
            {tCommon('common.actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isDeleteFolderModalOpen}
        onClose={handleDeleteFolderModalToggle}
        aria-labelledby="delete-folder-modal-title"
      >
        <ModalHeader labelId="delete-folder-modal-title" title={t('delete.folder.title')} titleIconVariant="warning" />
        <ModalBody>
          <Content>
            <Content component={ContentVariants.p}>{t('delete.folder.message')}</Content>
            <Content component={ContentVariants.p}>
              {t('delete.folder.confirmMessage_prefix')}{' '}
              <strong>{selectedFolder.replace(/\/$/, '').split('/').pop()}</strong>{' '}
              {t('delete.folder.confirmMessage_suffix')}
            </Content>
          </Content>
          <TextInput
            id="delete-folder-modal-input"
            aria-label="Delete folder modal input"
            value={folderToDelete}
            onChange={(_event, folderToDelete) => setFolderToDelete(folderToDelete)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (validateFolderToDelete()) {
                  handleDeleteFolderConfirm();
                }
              }
            }}
            validated={folderToDelete.length > 0 && !validateFolderToDelete() ? 'error' : 'default'}
          />
        </ModalBody>
        <ModalFooter>
          <Button
            key="confirm"
            variant="danger"
            onClick={handleDeleteFolderConfirm}
            isDisabled={!validateFolderToDelete() || isDeletingFolder}
            isLoading={isDeletingFolder}
          >
            {t('delete.folder.confirm')}
          </Button>
          <Button key="cancel" variant="secondary" onClick={handleDeleteFolderCancel}>
            {tCommon('common.actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isDeleteSelectedModalOpen}
        onClose={() => setIsDeleteSelectedModalOpen(false)}
        aria-labelledby="delete-selected-modal-title"
      >
        <ModalHeader
          labelId="delete-selected-modal-title"
          title={t('delete.selected.title')}
          titleIconVariant="warning"
        />
        <ModalBody>
          <p>{t('delete.selected.message', { count: selectedItems.size })}</p>
          <Checkbox
            id="bulk-delete-confirm"
            label={t('delete.selected.confirmCheckbox')}
            isChecked={bulkDeleteConfirmed}
            onChange={(_event, checked) => setBulkDeleteConfirmed(checked)}
          />
        </ModalBody>
        <ModalFooter>
          <Button
            key="confirm"
            variant="danger"
            onClick={handleDeleteSelectedConfirm}
            isLoading={isDeletingSelected}
            isDisabled={!bulkDeleteConfirmed || isDeletingSelected}
          >
            {t('delete.selected.confirm', { count: selectedItems.size })}
          </Button>
          <Button key="cancel" variant="secondary" onClick={() => setIsDeleteSelectedModalOpen(false)}>
            {tCommon('common.actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isCreateFolderModalOpen}
        onClose={handleCreateFolderModalToggle}
        ouiaId="CreateFolderModal"
        aria-labelledby="create-folder-modal-title"
      >
        <ModalHeader labelId="create-folder-modal-title" title={t('createFolder.title')} />
        <ModalBody>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              if (newFolderName.length > 0 && !newFolderNameRulesVisibility) {
                handleNewFolderCreate();
              }
            }}
          >
            <FormGroup label={t('createFolder.nameLabel')} isRequired fieldId="folder-name">
              <TextInput
                isRequired
                type="text"
                id="folder-name"
                name="folder-name"
                aria-describedby="folder-name-helper"
                placeholder={t('createFolder.namePlaceholder')}
                value={newFolderName}
                onChange={(_event, newFolderName) => setNewFolderName(newFolderName)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (newFolderName.length > 0 && !newFolderNameRulesVisibility) {
                      handleNewFolderCreate();
                    }
                  }
                }}
                validated={newFolderNameRulesVisibility ? 'error' : 'default'}
              />
            </FormGroup>
          </Form>
          <Content hidden={!newFolderNameRulesVisibility}>
            <Content component={ContentVariants.small} className="bucket-name-rules">
              {t('createFolder.rules.header')}
              <ul>
                <li>{t('createFolder.rules.unique')}</li>
                <li>
                  {selectedLocation?.type === 's3'
                    ? t('createFolder.rules.s3Chars')
                    : t('createFolder.rules.localChars')}
                </li>
              </ul>
            </Content>
          </Content>
        </ModalBody>
        <ModalFooter>
          <Button
            key="create"
            variant="primary"
            onClick={handleNewFolderCreate}
            isDisabled={newFolderName.length < 1 || newFolderNameRulesVisibility}
          >
            {tCommon('common.actions.create')}
          </Button>
          <Button key="cancel" variant="link" onClick={handleNewFolderCancel}>
            {tCommon('common.actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isImportModelModalOpen}
        onClose={handleImportModelModalToggle}
        ouiaId="ImportModelModal"
        aria-labelledby="import-model-modal-title"
      >
        <ModalHeader labelId="import-model-modal-title" title={t('import.huggingface.title')} />
        <ModalBody>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              if (isHfFormValid()) {
                handleImportModelConfirm(event as unknown as React.MouseEvent);
              }
            }}
          >
            <FormGroup label={t('import.huggingface.modelId')} isRequired fieldId="model-name">
              <TextInput
                isRequired
                type="text"
                id="model-name"
                name="model-name"
                aria-describedby="model-name-helper"
                placeholder={t('import.huggingface.modelIdPlaceholder')}
                value={modelName}
                onChange={(_event, modelName) => setModelName(modelName)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (isHfFormValid()) {
                      handleImportModelConfirm(event as unknown as React.MouseEvent);
                    }
                  }
                }}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>{t('import.huggingface.helperText')}</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </Form>
          <Flex direction={{ default: 'column' }} className="upload-bars">
            {modelFiles.map((file) => (
              <FlexItem key={file}>
                <Progress
                  value={uploadToS3Percentages[file]?.loaded ?? 0}
                  title={`${file} - ${uploadToS3Percentages[file]?.status ?? ''}`}
                  measureLocation="outside"
                  variant={uploadToS3Percentages[file]?.status === 'completed' ? 'success' : undefined}
                  size={ProgressSize.sm}
                />
              </FlexItem>
            ))}
          </Flex>
        </ModalBody>
        <ModalFooter>
          <Button
            key="import"
            variant="primary"
            onClick={handleImportModelConfirm}
            isDisabled={!isHfFormValid() || currentImportJobId !== null}
          >
            {t('import.huggingface.importButton')}
          </Button>
          {currentImportJobId !== null && (
            <Button key="cancel-import" variant="danger" onClick={handleCancelImport}>
              {t('import.huggingface.cancelImport')}
            </Button>
          )}
          <Button key="close" variant="link" onClick={handleImportModelClose}>
            {tCommon('common.actions.close')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isUploadSingleFileModalOpen}
        onClose={handleUploadSingleFileModalToggle}
        aria-labelledby="upload-single-modal-title"
      >
        <ModalHeader labelId="upload-single-modal-title" title={t('upload.single.title')} />
        <ModalBody>
          <FileUpload
            id="simple-file"
            value={singleFileUploadValue}
            filename={singleFilename}
            filenamePlaceholder={t('upload.single.dragDropText')}
            onFileInputChange={handleFileInputChange}
            onClearClick={handleClear}
            browseButtonText={t('upload.single.browseFiles')}
          />
          <Flex direction={{ default: 'column' }} className="upload-bars">
            <FlexItem hidden={!(uploadPercentages[singleFilename] && uploadPercentages[singleFilename].loaded !== 0)}>
              <Progress
                value={uploadPercentages[singleFilename]?.loaded ?? 0}
                title={t('upload.single.progress.toBackend')}
                size={ProgressSize.sm}
              />
            </FlexItem>
            <FlexItem
              hidden={!(uploadToS3Percentages[singleFilename] && uploadToS3Percentages[singleFilename].loaded !== 0)}
            >
              <Progress
                value={uploadToS3Percentages[singleFilename]?.loaded ?? 0}
                title={t('upload.single.progress.toS3')}
                size={ProgressSize.sm}
              />
            </FlexItem>
          </Flex>
        </ModalBody>
        <ModalFooter>
          <Button key="confirm" variant="primary" onClick={handleUploadFileConfirm} isDisabled={singleFilename === ''}>
            {tCommon('common.actions.upload')}
          </Button>
          <Button key="cancel" variant="link" onClick={handleUploadFileCancel}>
            {tCommon('common.actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={isUploadFilesModalOpen}
        onClose={handleUploadFilesClose}
        aria-labelledby="upload-files-modal-title"
      >
        <ModalHeader labelId="upload-files-modal-title" title={t('upload.multiple.title')} />
        <ModalBody>
          <MultipleFileUpload onFileDrop={handleFileDrop} isHorizontal={false}>
            <MultipleFileUploadMain titleIcon={<UploadIcon />} titleText={t('upload.multiple.dragDropText')} />
            {showStatus && (
              <MultipleFileUploadStatus
                statusToggleText={t('upload.multiple.statusText', {
                  uploaded: successfullyUploadedFileCount,
                  total: currentFiles.length,
                })}
                statusToggleIcon={statusIcon}
                aria-label="Current uploads"
              >
                {currentFiles.map((file) => {
                  // Calculate progress key for this file (must match handleFileDrop and handleFileUpload logic)
                  const filePath = file.path.replace(/^\//, '');
                  const progressKey = currentPath
                    ? currentPath.endsWith('/')
                      ? currentPath + filePath
                      : currentPath + '/' + filePath
                    : filePath;

                  // For local/PVC storage, use axios progress (uploadPercentages)
                  // For S3 storage, use SSE progress (uploadToS3Percentages)
                  const isLocalStorage = selectedLocation?.type === 'local';
                  const progressData = isLocalStorage
                    ? uploadPercentages[progressKey]
                    : uploadToS3Percentages[progressKey];

                  const progressValue = progressData?.loaded ?? 0;

                  // Determine status: use S3 status if available, or infer from uploadedFiles
                  const s3Status = uploadToS3Percentages[progressKey]?.status;
                  const uploadedFile = uploadedFiles.find((f) => f.path === file.path);
                  const inferredStatus =
                    uploadedFile?.loadResult === 'success'
                      ? 'completed'
                      : uploadedFile?.loadResult === 'danger'
                        ? 'failed'
                        : progressValue === 100
                          ? 'completed'
                          : progressValue > 0
                            ? 'uploading'
                            : 'queued';
                  const status = s3Status || inferredStatus;

                  return (
                    <MultipleFileUploadStatusItem
                      file={file}
                      key={file.path}
                      fileName={file.path + (status ? ' - ' + status : '')}
                      onClearClick={() => removeFiles([file.path])}
                      progressHelperText={createHelperText(file)}
                      customFileHandler={() => {}}
                      progressValue={progressValue}
                      progressVariant={status === 'completed' ? 'success' : undefined}
                    />
                  );
                })}
              </MultipleFileUploadStatus>
            )}
          </MultipleFileUpload>
        </ModalBody>
        <ModalFooter>
          <Button key="close" variant="primary" onClick={handleUploadFilesClose}>
            {tCommon('common.actions.close')}
          </Button>
        </ModalFooter>
      </Modal>
      <Modal
        className="standard-modal"
        isOpen={showCleanupDialog}
        onClose={() => handleCleanupDecision(false)}
        ouiaId="CleanupFilesModal"
        aria-labelledby="cleanup-files-modal-title"
      >
        <ModalHeader labelId="cleanup-files-modal-title" title={t('import.cleanup.title')} titleIconVariant="warning" />
        <ModalBody>
          <Content>
            <Content component={ContentVariants.p}>{t('import.cleanup.message')}</Content>
            <ul>
              {cancelledJobInfo?.files?.map((file: CancelledJobFile, index: number) => (
                <li key={index}>
                  {file.destinationPath.split('/').pop()} - {file.status}
                </li>
              ))}
            </ul>
            <Content component={ContentVariants.p}>{t('import.cleanup.keepOrDelete')}</Content>
          </Content>
        </ModalBody>
        <ModalFooter>
          <Button
            key="delete"
            variant="danger"
            onClick={() => handleCleanupDecision(true)}
            isLoading={isDeletingFiles}
            isDisabled={isDeletingFiles}
          >
            {t('import.cleanup.deleteAll')}
          </Button>
          <Button
            key="keep"
            variant="primary"
            onClick={() => handleCleanupDecision(false)}
            isDisabled={isDeletingFiles}
          >
            {t('import.cleanup.keepFiles')}
          </Button>
        </ModalFooter>
      </Modal>
      <TransferAction
        isOpen={isTransferModalOpen}
        onClose={() => {
          setIsTransferModalOpen(false);
          // Refresh file list after transfer completes
          if (selectedLocation && selectedLocation.available) {
            refreshFiles(selectedLocation, path || '', null, false, undefined, abortControllerRef.current || undefined);
          }
          // Clear selection
          setSelectedItems(new Set());
        }}
        sourceLocationId={locationId!}
        sourceType={selectedLocation?.type || 's3'}
        sourcePath={currentPath}
        selectedFiles={Array.from(selectedItems)}
        currentListing={[...directories, ...files]}
      />
      {/* Screen reader status announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="pf-v6-screen-reader">
        {viewingFile && t('accessibility.loadingFilePreview')}
        {downloadingFile && t('accessibility.downloadingFile')}
        {isDeletingSelected && t('accessibility.deletingItems', { count: selectedItems.size })}
        {deepSearchActive && t('accessibility.deepSearchInProgress')}
        {isLoadingMore && t('accessibility.loadingMoreFiles')}
      </div>
      {/* File Details Modal (S3 only) */}
      <FileDetailsModal
        isOpen={isFileDetailsModalOpen}
        onClose={handleFileDetailsClose}
        bucketName={locationId || ''}
        filePath={selectedFileForDetails}
        storageType={selectedLocation?.type || 's3'}
      />
    </div>
  );
};

export default StorageBrowser;
