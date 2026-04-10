package spaces

type ResolvedHandle struct {
	Query           string
	CanonicalHandle string
	Space           string
	Label           string
	Sovereignty     string
	NumID           string
	Roots           []string
	ZoneJSON        string
	Verification    VerificationSummary
}

type VerificationSummary struct {
	PinnedTrust bool
	TrustSource string
	TrustID     string
}
