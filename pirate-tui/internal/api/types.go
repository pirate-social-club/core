package api

type OnboardingStatus struct {
	GeneratedHandleAssigned       bool     `json:"generated_handle_assigned"`
	CleanupRenameAvailable        bool     `json:"cleanup_rename_available"`
	UniqueHumanVerificationStatus string   `json:"unique_human_verification_status"`
	NamespaceVerificationStatus   string   `json:"namespace_verification_status"`
	CommunityCreationReady        bool     `json:"community_creation_ready"`
	MissingRequirements           []string `json:"missing_requirements"`
	RedditVerificationStatus      string   `json:"reddit_verification_status"`
	RedditImportStatus            string   `json:"reddit_import_status"`
	SuggestedCommunityIDs         []string `json:"suggested_community_ids"`
}

type RedditVerification struct {
	RedditUsername       string  `json:"reddit_username"`
	Status               string  `json:"status"`
	VerificationHint     *string `json:"verification_hint"`
	CodePlacementSurface *string `json:"code_placement_surface"`
	LastCheckedAt        *string `json:"last_checked_at"`
	FailureCode          *string `json:"failure_code"`
}

type RedditImportSummary struct {
	RedditUsername       string               `json:"reddit_username"`
	ImportedAt           string               `json:"imported_at"`
	AccountAgeDays       *int                 `json:"account_age_days"`
	GlobalKarma          *int                 `json:"global_karma"`
	TopSubreddits        []TopSubreddit       `json:"top_subreddits"`
	ModeratorOf          []string             `json:"moderator_of"`
	InferredInterests    []string             `json:"inferred_interests"`
	SuggestedCommunities []SuggestedCommunity `json:"suggested_communities"`
	CoverageNote         *string              `json:"coverage_note"`
}

type TopSubreddit struct {
	Subreddit  string `json:"subreddit"`
	Karma      *int   `json:"karma"`
	Posts      *int   `json:"posts"`
	RankSource string `json:"rank_source"`
}

type SuggestedCommunity struct {
	CommunityID string `json:"community_id"`
	Name        string `json:"name"`
	Reason      string `json:"reason"`
}

type FeedResponse struct {
	Items      []LocalizedPostResponse `json:"items"`
	NextCursor *string                 `json:"next_cursor"`
}

type LocalizedPostResponse struct {
	Post           Post    `json:"post"`
	UpvoteCount    int     `json:"upvote_count"`
	DownvoteCount  int     `json:"downvote_count"`
	ViewerVote     *int    `json:"viewer_vote"`
	TranslatedBody *string `json:"translated_body"`
}

type Post struct {
	PostID         string  `json:"post_id"`
	CommunityID    string  `json:"community_id"`
	PostType       string  `json:"post_type"`
	IdentityMode   string  `json:"identity_mode"`
	AnonymousLabel *string `json:"anonymous_label"`
	Title          *string `json:"title"`
	Body           *string `json:"body"`
	Caption        *string `json:"caption"`
	CreatedAt      string  `json:"created_at"`
}

type CommunityListResponse struct {
	Items      []Community `json:"items"`
	NextCursor *string     `json:"next_cursor"`
}

type Community struct {
	CommunityID           string  `json:"community_id"`
	DisplayName           string  `json:"display_name"`
	Description           *string `json:"description"`
	Status                string  `json:"status"`
	MembershipMode        string  `json:"membership_mode"`
	MemberCount           *int    `json:"member_count"`
	QualifiedMemberCount  *int    `json:"qualified_member_count"`
	CivicScaleTier        *string `json:"civic_scale_tier"`
	RegistryPublishedAt   *string `json:"registry_published_at"`
	NamespaceVerification *string `json:"namespace_verification_id"`
}

type RedditImportStartResult struct {
	Job RedditImportJob `json:"job"`
}

type RedditImportJob struct {
	JobID     string  `json:"job_id"`
	JobType   string  `json:"job_type"`
	Status    string  `json:"status"`
	ResultRef *string `json:"result_ref"`
}
