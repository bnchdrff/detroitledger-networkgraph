function got_orgs(data) {
  var promises = {};
  window.orgs = {};

  var create_cb_promise = function(cb_name) {
    var promise = new RSVP.Promise(function(resolve, reject) {
      window[cb_name] = function(data) {
        resolve(data);
      };
    });
    return promise;
  };

  var add_jsonp_script = function(org_id, cb_name) {
    var s = document.createElement('script');
    s.setAttribute('src', 'https://data.detroitledger.org/api/1.0/orgs/' + org_id + '/board_members.jsonp?callback=' + cb_name);
    document.body.appendChild(s);
  };

  // create promise callback for each org in the form of "org_123"
  // & also fill our local orgs info hash, for later reference
  data.orgs.forEach(function(org) {
    var cb = 'org_' + org.id;
    promises[cb] = create_cb_promise(cb);
    window.orgs[cb] = org;
  });

  // establish promises
  RSVP.hash(promises)
    .then(draw_charts)
    .catch(function(reason) {
      debugger;
    });
  // and then add scripts
  _.forEach(data.orgs, function(org) {
    add_jsonp_script(org.id, 'org_' + org.id);
  });
}

function draw_charts (data) {
  var all_people = [];
  var all_orgs = [];
  var all_board_terms = [];

  var get_people_from_org_board_members = function(board_members) {
    var people = [];

    var people_ids = _.uniq(_.pluck(board_members, "person_id"));

    _.forEach(people_ids, function (person_id) {
      var boardmember = _.findWhere(board_members, {person_id: person_id.toString()});
      var name = boardmember.name;
      var person = {
        id: parseInt(person_id),
        name: name,
        t: "person"
      };
      people.push(person);
    });

    return people;
  };

  var get_board_terms_from_org_board_members = function(board_members, org_id) {
    var board_terms = [];

    _.forEach(board_members, function (board_membership) {
      board_terms.push({
        source: org_id,
        target: parseInt(board_membership.person_id),
        label: board_membership.position,
        amount: board_membership.compensation,
        startyear: board_membership.term_start.substr(0,4),
        endyear: board_membership.term_end.substr(0,4)
      });
    });

    return board_terms;
  };

  _.forEach(data, function(datum, key) {
    var org_id = parseInt(key.substr(4));

    all_people = all_people.concat(get_people_from_org_board_members(datum.board_members));
    all_board_terms = all_board_terms.concat(get_board_terms_from_org_board_members(datum.board_members, org_id));
  });


  _.forEach(window.orgs, function(org) {
    all_orgs.push({
      id: org.id,
      name: org.title,
      t: 'Organization'
    });
  });

  window.data = {
    nodes: all_people.concat(all_orgs),
    links: all_board_terms,
    mLinkNum: {},
  };

  var nodeIds = _.pluck(window.data.nodes, 'id');
  _.forEach(window.data.links, function (l) {
    l.source = nodeIds.indexOf(l.source);
    l.target = nodeIds.indexOf(l.target);
  });

  doEverything(window.data);
}

function normalize_cat_name(name) {
  return name.trim().toLowerCase();
}

/**
 * Gets neighbors of a node, based on its edges.
 *
 * @todo degrees
 */
function get_neighbors(id, degree, edges) {
  return _.uniq(
    _.reduce(edges, function (memo, edge) {
      var source;
      var target;
      source = (edge.source.id) ? edge.source.id : edge.source;
      target = (edge.target.id) ? edge.target.id : edge.target;
      if (source === id) {
        memo.push(target);
      }
      if (target === id) {
        memo.push(source);
      }
      return memo;
    }, [])
  );
}

function addNeighborsToNodes(nodes, edges, degree) {
  var newnodes = _.map(nodes, function (node) {
    node.neighbors = get_neighbors(node.id, degree, edges);
    return node;
  });
  return newnodes;
}

function doEverything(data) {

  var width = window.innerWidth,
      height = window.innerHeight;

  var force = cola.d3adaptor()
      .nodes(d3.values(data.nodes))
      .links(data.links)
      .size([width, height])
      .symmetricDiffLinkLengths(17)
      //.avoidOverlaps(true)
      .on("tick", tick)
      .start(12, 17, 22);

  data.nodes = addNeighborsToNodes(data.nodes, data.links, 1);

  var zoom = d3.behavior.zoom()
      .scaleExtent([1, 10])
      .on("zoom", zoomed);

  window.zoom = zoom;

  var svg = d3.select("#graph").append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", "translate(0,0)")
      .call(zoom);

   window.svg = svg;

  var rect = svg.append("rect")
      .attr("width", width)
      .attr("height", height)
      .style("fill", "none")
      .style("pointer-events", "all");

  var group = svg.append('g');

  function zoomed() {
    group.attr("transform", "translate(" + d3.event.translate + ")scale(" + d3.event.scale + ")");
  }
  
  var link = group.selectAll(".link")
        .data(force.links())
        .enter().append("svg:path")
        .attr("class", "link")
        .each(function(d) {
          d.grayed_out = true;
        })
        .style("stroke", function (d) {
          var colorLink;
            if (d.tags == "Grant") {
              colorLink = "green";
            }
            else {
              colorLink = "black";
            }
            d.stroke = colorLink;
            return colorLink;
        })

        .on('mouseover', function (d) {
          if (d.grayed_out == false) {
            d3.select(this).style({stroke: 'yellow'});
            this.style.strokeWidth = '6px';

            document.getElementById("labels").innerHTML = d.source.name + " <br />"
              + " is linked to <br />" 
              + d.target.name + " <br />"
              + "Relationship: " + d.label + " <br />"
              + "Year: " + d.startyear;
          }
        })

        .on('mouseout', function (d) {
          d3.select(this).style("stroke", function (d) {
            var colorLink;
            if (d.tags == "Grant") {
              colorLink = "green";
            }
            else {
              colorLink = "black";
            }
            this.style.strokeWidth = '1px';
            d.stroke = colorLink;
            return colorLink;
          });
        });

  sortLinks();
  setLinkIndexAndNum();

  var node = group.selectAll(".node")
      .append('g').data(force.nodes());

  node.enter().append("g")
      .append("path")
      .attr("class", "node")
      .attr("d",  d3.svg.symbol().size(120)
        .type(function (d) {
          var typeStr;
          switch (d.t) {
            case "Organization":
            case "Company":
            case "Foundation":
            case "Municipality":
              typeStr = "square";
              break;
            case "Person":
            case "Board":
              typeStr = "circle";
              break;
            case "District":
              typeStr = "triangle-down";
              break;
            case "School":
            case "Building":
              typeStr = "triangle-up";
              break;
            case "University":
            case "EMO":
            default:
              typeStr = "diamond";
              break;
          }
          return typeStr;
        })
      )
      .style("fill", function (d) {
        var colorStr;
        switch (d.t) {
          case "Organization":
            colorStr = 'blue';
          case "Company":
            colorStr = 'red';
          case "Foundation":
            colorStr = 'purple';
            break;
          case "Municipality":
            colorStr = 'pink';
            break;
          case "Person":
            colorStr = 'brown';
            break;
          case "Board":
            colorStr = 'green';
            break;
          case "District":
          case "School":
            colorStr = 'orange';
            break;
          case "Building":
            colorStr = 'green';
            break;
          case "University":
            colorStr = 'yellow';
            break;
          case "EMO":
          default:
            colorStr = 'red';
            break;
        }
        d.fillColor = colorStr;
        d.toggled = false;
        return colorStr;
      })
      .on("mouseover", mouseover)
      .on("mouseout", mouseout)
      .on("click", toggle_node);

  node.append("text")
      .style("fill", "black")
      .attr("x", 12)
      .attr("dy", ".35em")
      .text(function (d) {
        return d.name;
      });

  function tick() {
    link
      .attr("d", function (d) {
        var dx = d.target.x - d.source.x,
            dy = d.target.y - d.source.y,
            dr = Math.sqrt(dx * dx + dy * dy);
        var lTotalLinkNum = data.mLinkNum[d.source.index + "," + d.target.index] || data.mLinkNum[d.target.index + "," + d.source.index];
        if (lTotalLinkNum > 1) {
          dr = dr/(1 + (1/lTotalLinkNum) * (d.linkindex - 1));
        }
        return "M" + d.source.x + "," + d.source.y +
          "A" + dr + "," + dr + " 0 0 1," + d.target.x + "," + d.target.y +
          "A" + dr + "," + dr + " 0 0 0," + d.source.x + "," + d.source.y;
      });

    node
      .attr("transform", function (d) {
        return "translate(" + d.x + "," + d.y + ")";
      });

  }

  function mouseover() {
    d3.select(this)
       .transition()
       .duration(750)
       .attr('transform', 'scale(2)');
  }

  function mouseout() {
    d3.select(this)
       .transition()
       .duration(750)
       .attr('transform', 'scale(1)');
  }

  function sortLinks() {
    data.links.sort(function (a, b) {
      if (a.source.index > b.source.index) {
        return 1;
      }
      else if (a.source.index < b.source.index) {
        return -1;
      }
      else {
        if (a.target.index > b.target.index) {
          return 1;
        }
        if (a.target.index < b.target.index) {
          return -1;
        }
        else {
          return 0;
        }
      }
    });
  }

  function setLinkIndexAndNum() {
    for (var i = 0; i < data.links.length; i++) {
      if (i != 0 &&
        data.links[i].source.index == data.links[i-1].source.index &&
        data.links[i].target.index == data.links[i-1].target.index) {
        data.links[i].linkindex = data.links[i-1].linkindex + 1;
      }
      else {
        data.links[i].linkindex = 1;
      }
      if (data.mLinkNum[data.links[i].target.index + "," + data.links[i].source.index] !== undefined) {
        data.mLinkNum[data.links[i].target.index + "," + data.links[i].source.index] = data.links[i].linkindex;
      }
      else {
        data.mLinkNum[data.links[i].source.index + "," + data.links[i].target.index] = data.links[i].linkindex;
      }
    }
  }

  // Build filter widget
  build_year_filter_widget('#filters', get_all_start_years(data.links));

  // Hide the orphans, after setting link visibility explicitly
  d3.selectAll('.link').style('visibility', 'visible');
  hide_orphans();
}

/**
 * Sets a certain node (data node and the corresponding d3 dom element)
 * as clicked or unclicked.
 *
 * Needs context `this` as current DOM element
 *
 * @param node_to_toggle
 *   d3 data object
 *
 * @param index
 *   d3 index, per its API (unused)
 *
 * @param context
 *   if u don't want the function to use `this`
 *
 * @return
 *   true if it works
 */
function toggle_node(node_to_toggle, index, context) {
  var thiiiiiis = (context ? context : this);
  node_to_toggle.toggled = true;
  d3.select(thiiiiiis).style('fill', 'yellow');
  d3.selectAll('.node')
    .filter(function(d_node) { return d_node != node_to_toggle; })
    .style('fill', function(d_node) { return d_node.fillColor; });

  highlight_neighbor_nodes(node_to_toggle.id, node_to_toggle.neighbors);

  return true;
}

/**
 * Given the d3 id of a node in our data, highlight its neighbors
 * and set zoom and pan to focus on this neighborhood.
 *
 * @param center_node_id
 * @param neighbors
 * @param should_zoom
 *   true if we should zoom to extant
 * @return null
 */
function highlight_neighbor_nodes(center_node_id, neighbors, should_zoom) {
  var extant = {
    x:[],
    y:[]
  };

  var width = window.innerWidth,
      height = window.innerHeight;

  d3.selectAll('.node').classed('active', function (d) {
    if (d.id !== center_node_id && !_.contains(neighbors, d.id)) {
      d.grayed_out == true;
      return false;
    }
    extant.x.push(d.x);
    extant.y.push(d.y);
    return true;
  });

  var dx = _.max(extant.x) - _.min(extant.x),
      dy = _.max(extant.y) - _.min(extant.y),
      x = (_.max(extant.x) + _.min(extant.x)) / 2,
      y = (_.max(extant.y) + _.min(extant.y)) / 2,
      scale = .76 / Math.max(dx / width, dy / height), // .76 is nice @todo include labels in extant?
      translate = [width / 2 - scale * x, height / 2 - scale * y];

  if (should_zoom) {
    svg.transition()
       .duration(750)
       .call(zoom.translate(translate).scale(scale).event);
  }

  d3.selectAll('text').classed('active', function (d) {
    if (d.hasOwnProperty('source') || d.hasOwnProperty('target')) {
      if (d.source.id == center_node_id || d.target.id == center_node_id) {
        return true;
      } else {
        return false;
      }
    } else {
    if (d.id !== center_node_id && !_.contains(neighbors, d.id)) {
      d.grayed_out == true;
      return false;
    }
    return true;
    }
  });

  d3.selectAll('.link').classed('active', function (d) {
    if (d.hasOwnProperty('source') || d.hasOwnProperty('target')) {
      if (d.source.id == center_node_id || d.target.id == center_node_id) {
        d.grayed_out = false;
        return true;
      } else {
        d.grayed_out = true;
        return false;
      }
    }
  });
}

/**
 * Given data.links, return chronologically sorted array of years.
 *
 * @param links
 *   data.links
 *
 * @return
 *   array of year integers
 */
function get_all_start_years(links) {
  return _.uniq(
    _.reduce(links, function(memo, link) {
      if (link.startyear !== null) {
        memo.push(link.startyear);
      }
      return memo;
    }, [])
  ).sort();
}

/**
 * Build year filter widget.
 *
 * Via http://jsfiddle.net/zhanghuancs/cuYu8/
 *
 * @param container_selector
 *   string to use as d3 selector for element in which to build widget
 *
 * @param year_opts
 *   array of years to offer as options
 */
function build_year_filter_widget(container_selector, year_opts) {
  d3.select(container_selector)
    .selectAll('div')
    .data(year_opts)
    .enter()
    .append('label')
    .each(function(d) {
      d3.select(this)
        .append('input')
        .attr('type', 'checkbox')
        .attr('checked', true)
        .on('click', function(d) {
          filter_graph_by_year(d, (this.checked ? 'visible' : 'hidden'));
        })
      d3.select(this)
        .append('span')
        .text(function(d) {
          return d;
        });
    });
}

/**
 * Find links in the network graph with startdate year,
 * and hide (or show) them along with their labels and
 * potentially orphaned nodes.
 *
 * @param year
 *   integer selected year
 *
 * @param visibility
 *   string css visibility value
 */
function filter_graph_by_year(year, visibility) {
  d3.selectAll('.link')
    .style('visibility', function(d, i) {
      d.visibility = (d.startyear == year ? visibility : $(this).css('visibility'));
      // hide corresponding text label
      if (d.visibility == 'hidden') {
        d3.selectAll('text').filter(function(d_text) {
          return d_text == d;
        }).style('visibility', 'hidden');
      } else {
        d3.selectAll('text').filter(function(d_text) {
          return d_text == d;
        }).style('visibility', 'visible');
      }
      return d.visibility;
    });

  hide_orphans();
}

function hide_orphans() {
  d3.selectAll('.node')
    .style('visibility', function(d_node, i_node) {
      var hide_this = true;
      // If any of this node's links are visible, this node shouldn't be hidden.
      d3.selectAll('.link')
        .each(function(d_link, i_link) {
          if (d_link.source === d_node || d_link.target === d_node) {
            if (this.style.visibility == 'visible') {
              hide_this = false;
              d3.selectAll('text')
                .filter(function (d_text) { return d_text == d_link; })
                .style('visibility', 'visible');
              return 'visible';
            }
          }
        });
      if (hide_this) {
        d3.selectAll('text')
          .filter(function (d_text) { return d_text == d_node; })
          .style('visibility', 'hidden');
        return 'hidden';
      } else {
        d3.selectAll('text')
          .filter(function (d_text) { return d_text == d_node; })
          .style('visibility', 'visible');
        return 'visible';
      }
    });
}
