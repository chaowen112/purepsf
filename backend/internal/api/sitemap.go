package api

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const siteBase = "https://purepsf.tet.sg"

func (s *Server) handleRobotsTxt(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	body := strings.Join([]string{
		"User-agent: *",
		"Allow: /",
		// Block the API surface from crawl — these aren't HTML pages and
		// just waste crawl budget.
		"Disallow: /api/",
		"Disallow: /tiles/",
		"",
		"Sitemap: " + siteBase + "/sitemap.xml",
		"",
	}, "\n")
	_, _ = w.Write([]byte(body))
}

type sitemapURL struct {
	XMLName    xml.Name `xml:"url"`
	Loc        string   `xml:"loc"`
	LastMod    string   `xml:"lastmod,omitempty"`
	ChangeFreq string   `xml:"changefreq,omitempty"`
	Priority   string   `xml:"priority,omitempty"`
}

type sitemapDoc struct {
	XMLName xml.Name     `xml:"urlset"`
	Xmlns   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

// handleSitemapXML emits ~1.5k URLs: home, agents, all 332 subzones, and the
// top ~1000 projects by transaction count. Skipping the long tail of inactive
// projects keeps the sitemap under the 50k-URL / 50 MB limit and focuses
// crawl budget on pages most likely to satisfy a search query.
func (s *Server) handleSitemapXML(w http.ResponseWriter, r *http.Request) {
	today := time.Now().UTC().Format("2006-01-02")
	urls := []sitemapURL{
		{Loc: siteBase + "/",       LastMod: today, ChangeFreq: "daily",   Priority: "1.0"},
		{Loc: siteBase + "/agents", LastMod: today, ChangeFreq: "weekly",  Priority: "0.8"},
	}

	// Subzones: 332 polygons, all worth indexing.
	subRows, err := s.pool.Query(r.Context(), `
		SELECT id, subzone_name FROM planning_subzones ORDER BY id`)
	if err != nil {
		s.logger.Error("sitemap subzones", "err", err)
		http.Error(w, "sitemap query error", http.StatusInternalServerError)
		return
	}
	for subRows.Next() {
		var id int64
		var name string
		if err := subRows.Scan(&id, &name); err != nil {
			subRows.Close()
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		urls = append(urls, sitemapURL{
			Loc:        fmt.Sprintf("%s/z/%d/%s", siteBase, id, slugify(name)),
			LastMod:    today,
			ChangeFreq: "weekly",
			Priority:   "0.7",
		})
	}
	subRows.Close()

	// Top 1000 projects by transaction count.
	projRows, err := s.pool.Query(r.Context(), `
		SELECT p.id, p.name
		FROM projects p
		WHERE p.geom IS NOT NULL
		ORDER BY (SELECT COUNT(*) FROM transactions t WHERE t.project_id = p.id) DESC
		LIMIT 1000`)
	if err != nil {
		s.logger.Error("sitemap projects", "err", err)
		http.Error(w, "sitemap query error", http.StatusInternalServerError)
		return
	}
	defer projRows.Close()
	for projRows.Next() {
		var id int64
		var name string
		if err := projRows.Scan(&id, &name); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		urls = append(urls, sitemapURL{
			Loc:        fmt.Sprintf("%s/p/%d/%s", siteBase, id, slugify(name)),
			LastMod:    today,
			ChangeFreq: "weekly",
			Priority:   "0.6",
		})
	}

	doc := sitemapDoc{
		Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
		URLs:  urls,
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(xml.Header))
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	_ = enc.Encode(doc)
}

// slugify mirrors the frontend slug helper so sitemap URLs match canonical
// React Router paths. Lower-case, ASCII-safe, non-alphanum -> hyphen.
func slugify(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	dash := true
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		default:
			if !dash {
				b.WriteRune('-')
				dash = true
			}
		}
	}
	out := strings.TrimRight(b.String(), "-")
	if len(out) > 80 {
		out = strings.TrimRight(out[:80], "-")
	}
	return out
}
